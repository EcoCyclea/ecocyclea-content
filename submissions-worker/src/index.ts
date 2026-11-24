/**
 * ecocyclea-submissions — Worker Cloudflare des soumissions « Marques engagées ».
 *
 * Contrat (spec feature-spec-eco-brand-directory.md §6) :
 *   POST /submissions        {name, url, category, reason, antiSpamToken}
 *                            → 201 {code, status:'pending'} (code aléatoire 8 car.)
 *   GET  /submissions/:code  → {code, status: pending|accepted|published|rejected}
 *   POST /reports            {type, brandSlug?, message, antiSpamToken} → {ok:true}
 *   GET  /                   → page publique : marques publiées récemment + grille
 *   GET  /review?secret=…    → page de revue interne (file + preuves + actions)
 *   POST /review/accept/:id?secret=…  → {prUrl} PR GitHub préremplie (ajout marque)
 *   POST /review/reject/:id?secret=…  {reason} → marque rejetée (jamais affichée)
 *
 * Confidentialité : aucun compte, aucun email ; seul le hash SHA-256 du jeton
 * d'appareil est stocké (rate limiting), jamais le jeton lui-même.
 */
import { reviewPageHtml } from './reviewPage';

interface Env {
  DB: D1Database;
  RATE_KV: KVNamespace;
  REVIEW_SECRET?: string;
  /** Fournisseur Git du dépôt de contenu : 'github' (défaut) ou 'gitlab'. */
  GIT_PROVIDER?: string;
  /** URL web du dépôt de contenu, ex. https://github.com/EcoCyclea/ecocyclea-content */
  GIT_WEB_BASE_URL?: string;
  RATE_LIMIT_PER_HOUR: string;
}

const BRAND_CATEGORIES = [
  'culottes-menstruelles',
  'coupe-menstruelle',
  'tampons-serviettes-bio',
  'zero-dechet',
  'lingerie-soins',
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I (lisibilité)

function randomCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < len; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Review-Secret',
      'Access-Control-Max-Age': '86400',
    },
  });
}

async function ensureSchema(db: D1Database): Promise<void> {
  // Une requête par statement (db.exec multi-statement peu fiable selon runtimes)
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL, device_token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', review_notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, brand_slug TEXT, message TEXT NOT NULL, device_token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'open\', created_at TEXT NOT NULL)',
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)').run();
}

/** Rate limiting par hash de jeton : N soumissions / heure. */
async function checkRateLimit(env: Env, tokenHash: string): Promise<boolean> {
  const limit = Math.max(1, parseInt(env.RATE_LIMIT_PER_HOUR || '5', 10));
  const key = `rl:${tokenHash}`;
  const current = parseInt((await env.RATE_KV.get(key)) || '0', 10);
  if (current >= limit) return false;
  await env.RATE_KV.put(key, String(current + 1), { expirationTtl: 3600 });
  return true;
}

function isReviewAuthorized(req: Request, env: Env): boolean {
  if (!env.REVIEW_SECRET) return false;
  const url = new URL(req.url);
  const header = req.headers.get('X-Review-Secret');
  return header === env.REVIEW_SECRET || url.searchParams.get('secret') === env.REVIEW_SECRET;
}

function validateSubmission(body: any): string | null {
  if (!body || typeof body !== 'object') return 'corps JSON requis';
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.length > 60)
    return 'name invalide (2–60 caractères)';
  if (typeof body.url !== 'string' || !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(body.url.trim()))
    return 'url invalide (HTTPS requis)';
  if (!BRAND_CATEGORIES.includes(body.category)) return 'category hors liste blanche';
  if (typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000)
    return 'reason invalide (10–1000 caractères)';
  if (typeof body.antiSpamToken !== 'string' || body.antiSpamToken.length < 16 || body.antiSpamToken.length > 128)
    return 'antiSpamToken invalide';
  return null;
}

/** Construit l'URL de PR/MR préremplie qui ajoute la marque au flux (GitHub ou GitLab). */
function prefilledPrUrl(env: Env, row: { code: string; name: string; url: string; category: string; reason: string }): string {
  const provider = env.GIT_PROVIDER || 'github';
  const repoWeb = (env.GIT_WEB_BASE_URL || 'https://github.com/EcoCyclea/ecocyclea-content').replace(/\/+$/, '');
  const branch = `review/marque-${row.code.toLowerCase()}`;
  const brandEntry = {
    id: `brand-sub-${row.code.toLowerCase()}`,
    name: row.name,
    slug: row.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    tagline: '— à compléter lors de la revue —',
    description: '— à compléter lors de la revue (≤ 300 caractères) —',
    categories: [row.category],
    labels: [],
    sustainabilityHighlights: ['—', '—', '—'],
    score: 0,
    rubricVersion: '1.0',
    url: row.url,
    priceRange: '€€',
    reviewedBy: 'Équipe Ecocyclea',
    reviewedAt: new Date().toISOString().slice(0, 10),
    regions: ['fr-FR'],
  };
  const body = [
    `Proposition soumise via l'app (code **${row.code}**) — à revoir selon la grille v1.0 (score min. 60, preuves requises).`,
    '',
    `Site : ${row.url}`,
    '',
    `Justification soumise : ${row.reason}`,
    '',
    'À faire dans cette PR :',
    `1. Ajouter l'entrée suivante à \`content/brands/brands.fr-FR.json\` (compléter tagline/description/labels/score après revue) :`,
    '',
    '```json',
    JSON.stringify(brandEntry, null, 2),
    '```',
    '',
    '2. La CI valide schéma + score ≥ 60 + rubricVersion, puis publie le flux signé.',
  ].join('\n');
  const title = `Ajouter la marque « ${row.name} » à l'annuaire`;
  if (provider === 'gitlab') {
    const params = new URLSearchParams({
      'merge_request[source_branch]': branch,
      'merge_request[target_branch]': 'main',
      'merge_request[title]': title,
      'merge_request[description]': body,
    });
    return `${repoWeb}/-/merge_requests/new?${params.toString()}`;
  }
  const params = new URLSearchParams({ expand: '1', title, body });
  return `${repoWeb}/compare/main...${branch}?${params.toString()}`;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return corsPreflight();
    await ensureSchema(env.DB);

    // --- Soumission anonyme d'une marque ---
    if (path === '/submissions' && req.method === 'POST') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'JSON invalide' }, 400);
      }
      const err = validateSubmission(body);
      if (err) return json({ error: err }, 422);

      const tokenHash = await sha256Hex(body.antiSpamToken.trim());
      if (!(await checkRateLimit(env, tokenHash))) {
        return json({ error: 'Trop de soumissions pour cet appareil. Réessayez plus tard.' }, 429);
      }

      const code = randomCode(8);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO submissions (code, name, url, category, reason, device_token_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
        .bind(code, body.name.trim(), body.url.trim(), body.category, body.reason.trim(), tokenHash, now, now)
        .run();

      return json({ code, status: 'pending' }, 201);
    }

    // --- Statut par code (sans compte, sans donnée personnelle) ---
    const statusMatch = path.match(/^\/submissions\/([A-Z2-9]{8})$/);
    if (statusMatch && req.method === 'GET') {
      const row = await env.DB.prepare('SELECT code, status, updated_at FROM submissions WHERE code = ?')
        .bind(statusMatch[1])
        .first<{ code: string; status: string; updated_at: string }>();
      if (!row) return json({ error: 'code inconnu' }, 404);
      return json({ code: row.code, status: row.status, updatedAt: row.updated_at });
    }

    // --- Signalements / suggestions de mise à jour (file de revue) ---
    if (path === '/reports' && req.method === 'POST') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'JSON invalide' }, 400);
      }
      if (
        !body ||
        !['brand-report', 'brand-update'].includes(body.type) ||
        typeof body.message !== 'string' ||
        body.message.length < 5 ||
        body.message.length > 1000 ||
        typeof body.antiSpamToken !== 'string' ||
        body.antiSpamToken.length < 16
      ) {
        return json({ error: 'payload invalide' }, 422);
      }
      const tokenHash = await sha256Hex(body.antiSpamToken.trim());
      if (!(await checkRateLimit(env, tokenHash))) {
        return json({ error: 'Trop de requêtes pour cet appareil.' }, 429);
      }
      await env.DB.prepare(
        `INSERT INTO reports (type, brand_slug, message, device_token_hash, status, created_at)
         VALUES (?, ?, ?, ?, 'open', ?)`,
      )
        .bind(body.type, typeof body.brandSlug === 'string' ? body.brandSlug : null, body.message.trim(), tokenHash, new Date().toISOString())
        .run();
      return json({ ok: true }, 201);
    }

    // --- Page publique : transparence (publiées récentes + grille) ---
    if (path === '/' && req.method === 'GET') {
      const published = await env.DB.prepare(
        `SELECT name, url, category, updated_at FROM submissions WHERE status = 'published' ORDER BY updated_at DESC LIMIT 20`,
      ).all();
      const counts = await env.DB.prepare(
        `SELECT status, COUNT(*) AS n FROM submissions GROUP BY status`,
      ).all<{ status: string; n: number }>();
      const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marques engagées — transparence</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1c1c;line-height:1.5}h1{font-size:1.5rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e0e0e0;padding:.5rem;text-align:left;font-size:.9rem}.muted{color:#666;font-size:.85rem}</style></head>
<body><h1>Marques engagées — page de transparence</h1>
<p class="muted">Soumissions reçues : ${counts.results.map((c) => `${c.status} : ${c.n}`).join(' · ') || 'aucune'}</p>
<h2>Marques publiées récemment</h2>
<table><tr><th>Marque</th><th>Catégorie</th><th>Site</th><th>Publiée le</th></tr>
${published.results.map((r: any) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td><a href="${escapeHtml(r.url)}" rel="noopener">${escapeHtml(r.url)}</a></td><td>${escapeHtml(r.updated_at.slice(0, 10))}</td></tr>`).join('')}
</table>
<p class="muted">Chaque marque est revue selon la <a href="${(env.GIT_WEB_BASE_URL || 'https://github.com/EcoCyclea/ecocyclea-content').replace(/\/+$/, '')}/-/blob/main/docs/rubric-brand-v1.0.md">grille de revue publiée (v1.0)</a> avant publication. Les soumissions rejetées n’apparaissent nulle part.</p>
</body></html>`;
      return html(page);
    }

    // --- Page de revue interne (secret requis) ---
    if (path === '/review' && req.method === 'GET') {
      if (!isReviewAuthorized(req, env)) return json({ error: 'unauthorized' }, 401);
      return html(reviewPageHtml());
    }

    if (path === '/review/api/queue' && req.method === 'GET') {
      if (!isReviewAuthorized(req, env)) return json({ error: 'unauthorized' }, 401);
      const subs = await env.DB.prepare(
        `SELECT id, code, name, url, category, reason, status, review_notes, created_at, updated_at FROM submissions ORDER BY created_at DESC LIMIT 100`,
      ).all();
      const reports = await env.DB.prepare(
        `SELECT id, type, brand_slug, message, status, created_at FROM reports ORDER BY created_at DESC LIMIT 100`,
      ).all();
      return json({ submissions: subs.results, reports: reports.results });
    }

    const acceptMatch = path.match(/^\/review\/accept\/(\d+)$/);
    if (acceptMatch && req.method === 'POST') {
      if (!isReviewAuthorized(req, env)) return json({ error: 'unauthorized' }, 401);
      const row = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(acceptMatch[1]).first<any>();
      if (!row) return json({ error: 'introuvable' }, 404);
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE submissions SET status = 'accepted', updated_at = ? WHERE id = ?`).bind(now, row.id).run();
      return json({ ok: true, prUrl: prefilledPrUrl(env, row) });
    }

    const rejectMatch = path.match(/^\/review\/reject\/(\d+)$/);
    if (rejectMatch && req.method === 'POST') {
      if (!isReviewAuthorized(req, env)) return json({ error: 'unauthorized' }, 401);
      let body: any = {};
      try {
        body = await req.json();
      } catch {}
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : '';
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE submissions SET status = 'rejected', review_notes = ?, updated_at = ? WHERE id = ?`)
        .bind(reason, now, rejectMatch[1])
        .run();
      return json({ ok: true });
    }

    const publishMatch = path.match(/^\/review\/publish\/(\d+)$/);
    if (publishMatch && req.method === 'POST') {
      if (!isReviewAuthorized(req, env)) return json({ error: 'unauthorized' }, 401);
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE submissions SET status = 'published', updated_at = ? WHERE id = ?`).bind(now, publishMatch[1]).run();
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },
};

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

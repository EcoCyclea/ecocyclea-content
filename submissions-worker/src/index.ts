/**
 * ecocyclea-submissions — Worker Cloudflare des soumissions « Marques engagées ».
 *
 * Contrat (spec feature-spec-eco-brand-directory.md §6) :
 *   POST /submissions        {name, url, category, reason, antiSpamToken}
 *                            → 201 {code, status:'pending'|'accepted'} (code aléatoire 8 car.)
 *                            Si GITHUB_TOKEN est posé (GitHub) : la PR de revue est créée
 *                            directement et le statut passe à 'accepted'.
 *   GET  /submissions/:code  → {code, status: pending|accepted|published|rejected}
 *   POST /reports            {type, brandSlug?, message, antiSpamToken} → {ok:true}
 *   GET  /                   → page publique : marques publiées récemment + grille
 *   POST /webhooks/github    → webhook « Pull request » : branche review/marque-<code>
 *                            synchronise le statut (opened→accepted, merged→published,
 *                            closed→rejected). Signature X-Hub-Signature-256 vérifiée.
 *   GET  /review?secret=…    → page de revue interne (file + preuves + actions)
 *   POST /review/accept/:id?secret=…  → {prUrl} PR GitHub créée directement si GITHUB_TOKEN
 *                            est posé (sinon URL de PR préremplie à créer manuellement)
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
  /**
   * PAT GitHub fine-grained (contents: read/write sur le dépôt de contenu uniquement),
   * posé via `wrangler secret put GITHUB_TOKEN`. Sans lui, l'acceptation renvoie
   * seulement l'URL de PR préremplie (création manuelle).
   */
  GITHUB_TOKEN?: string;
  /** Secret du webhook GitHub (Settings → Webhooks) pour /webhooks/github. */
  GITHUB_WEBHOOK_SECRET?: string;
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

/** Vérifie la signature HMAC-SHA256 du webhook GitHub (X-Hub-Signature-256). */
async function verifyGitHubSignature(body: string, secret: string, header: string): Promise<boolean> {
  if (!header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expected = `sha256=${hex}`;
  // comparaison à longueur constante
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
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
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
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

type SubmissionRow = { code: string; name: string; url: string; category: string; reason: string };

/** Entrée marque (squelette) ajoutée au flux lors de l'acceptation — à compléter en revue. */
function brandEntryFor(row: SubmissionRow) {
  return {
    id: `brand-sub-${row.code.toLowerCase()}`,
    name: row.name,
    slug: row.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    tagline: '— à compléter lors de la revue —',
    description: '— à compléter lors de la revue (≤ 300 caractères) —',
    categories: [row.category],
    labels: [] as string[],
    sustainabilityHighlights: ['—', '—', '—'],
    score: 0,
    rubricVersion: '1.0',
    url: row.url,
    priceRange: '€€',
    reviewedBy: 'Équipe Ecocyclea',
    reviewedAt: new Date().toISOString().slice(0, 10),
    regions: ['fr-FR'],
  };
}

function prBodyFor(row: SubmissionRow, brandEntry: unknown): string {
  return [
    `Proposition soumise via l'app (code **${row.code}**) — à revoir selon la grille v1.0 (score min. 60, preuves requises).`,
    '',
    `Site : ${row.url}`,
    '',
    `Justification soumise : ${row.reason}`,
    '',
    'À faire dans cette PR :',
    `1. Compléter l'entrée ajoutée à \`content/brands/brands.fr-FR.json\` (tagline/description/labels/score après revue) :`,
    '',
    '```json',
    JSON.stringify(brandEntry, null, 2),
    '```',
    '',
    '2. La CI valide schéma + score ≥ 60 + rubricVersion, puis publie le flux signé.',
  ].join('\n');
}

/** Construit l'URL de PR/MR préremplie qui ajoute la marque au flux (GitHub ou GitLab). */
function prefilledPrUrl(env: Env, row: SubmissionRow): string {
  const provider = env.GIT_PROVIDER || 'github';
  const repoWeb = (env.GIT_WEB_BASE_URL || 'https://github.com/EcoCyclea/ecocyclea-content').replace(/\/+$/, '');
  const branch = `review/marque-${row.code.toLowerCase()}`;
  const brandEntry = brandEntryFor(row);
  const body = prBodyFor(row, brandEntry);
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

/** Parse owner/repo depuis GIT_WEB_BASE_URL (GitHub uniquement). */
function githubRepo(env: Env): { owner: string; repo: string } {
  const web = (env.GIT_WEB_BASE_URL || 'https://github.com/EcoCyclea/ecocyclea-content')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const m = web.match(/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!m) throw new Error('GIT_WEB_BASE_URL n’est pas un dépôt GitHub');
  return { owner: m[1], repo: m[2] };
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Crée la PR de revue directement sur GitHub (branche + commit de l'entrée squelette + PR).
 * Nécessite GITHUB_TOKEN (PAT fine-grained, contents read/write sur le dépôt de contenu).
 * Idempotent : si la branche/PR existe déjà, renvoie la PR existante.
 * Renvoie l'URL HTML de la PR.
 */
async function createReviewPr(env: Env, row: SubmissionRow): Promise<string> {
  const { owner, repo } = githubRepo(env);
  const branch = `review/marque-${row.code.toLowerCase()}`;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const brandEntry = brandEntryFor(row);
  const title = `Ajouter la marque « ${row.name} » à l'annuaire`;
  const body = prBodyFor(row, brandEntry);

  // 1. SHA de main
  const refRes = await fetch(`${api}/git/refs/heads/main`, { headers });
  if (!refRes.ok) throw new Error(`git/refs main: HTTP ${refRes.status}`);
  const sha = (await refRes.json() as any).object.sha as string;

  // 2. Branche (422 = existe déjà → on continue)
  const refCreate = await fetch(`${api}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!refCreate.ok && refCreate.status !== 422) throw new Error(`git/refs: HTTP ${refCreate.status}`);

  // 3. Lit le fichier des marques sur la branche et y ajoute l'entrée
  const filePath = 'content/brands/brands.fr-FR.json';
  const fileRes = await fetch(`${api}/contents/${filePath}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!fileRes.ok) throw new Error(`contents GET: HTTP ${fileRes.status}`);
  const file = (await fileRes.json()) as any;
  const data = JSON.parse(base64ToUtf8(file.content));
  if (!Array.isArray(data.brands)) throw new Error('brands.fr-FR.json: champ brands absent');
  data.brands = data.brands.filter((b: any) => b.id !== brandEntry.id);
  data.brands.push(brandEntry);

  // 4. Commit sur la branche
  const putRes = await fetch(`${api}/contents/${filePath}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `feat(brands): ajoute « ${row.name} » (soumission ${row.code}) — à compléter en revue`,
      content: utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
      branch,
      sha: file.sha as string,
    }),
  });
  if (!putRes.ok) throw new Error(`contents PUT: HTTP ${putRes.status}`);

  // 5. PR (422 = PR déjà ouvert pour cette branche → on le renvoie)
  const prRes = await fetch(`${api}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, body, head: branch, base: 'main' }),
  });
  if (prRes.status === 422) {
    const listRes = await fetch(`${api}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`, { headers });
    const list = (await listRes.json()) as any[];
    if (list.length > 0) return list[0].html_url as string;
    throw new Error('PR introuvable après 422');
  }
  if (!prRes.ok) throw new Error(`pulls: HTTP ${prRes.status}`);
  return ((await prRes.json()) as any).html_url as string;
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

      // Avec GITHUB_TOKEN (GitHub) : la PR de revue est créée immédiatement et la
      // soumission passe en 'accepted' (en revue côté PR). Le webhook /webhooks/github
      // fait ensuite évoluer le statut (merged → published, closed → rejected).
      // Sans token : reste 'pending', l'admin acceptera via /review/accept (URL préremplie).
      let status = 'pending';
      if ((env.GIT_PROVIDER || 'github') === 'github' && env.GITHUB_TOKEN) {
        try {
          const prUrl = await createReviewPr(env, {
            code,
            name: body.name.trim(),
            url: body.url.trim(),
            category: body.category,
            reason: body.reason.trim(),
          });
          await env.DB
            .prepare(`UPDATE submissions SET status = 'accepted', review_notes = ?, updated_at = ? WHERE code = ?`)
            .bind(`PR: ${prUrl}`, new Date().toISOString(), code)
            .run();
          status = 'accepted';
        } catch {
          // PR non créée (GitHub indisponible, etc.) → reste 'pending', acceptation manuelle possible.
        }
      }

      return json({ code, status }, 201);
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
      // Avec GITHUB_TOKEN (GitHub) : la PR est créée directement sur le dépôt.
      // Sinon : URL de PR préremplie à créer manuellement.
      if ((env.GIT_PROVIDER || 'github') === 'github' && env.GITHUB_TOKEN) {
        try {
          const prUrl = await createReviewPr(env, row);
          return json({ ok: true, prUrl, prCreated: true });
        } catch (err) {
          return json({ ok: true, prUrl: prefilledPrUrl(env, row), prCreated: false, githubError: String((err as Error).message || err) });
        }
      }
      return json({ ok: true, prUrl: prefilledPrUrl(env, row), prCreated: false });
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

    // --- Webhook GitHub : synchro du statut depuis le cycle de vie de la PR ---
    // Configurer : repo → Settings → Webhooks → https://<worker>/webhooks/github,
    // content-type application/json, secret = GITHUB_WEBHOOK_SECRET, event « Pull request ».
    if (path === '/webhooks/github' && req.method === 'POST') {
      const raw = await req.text();
      const secret = env.GITHUB_WEBHOOK_SECRET;
      if (!secret || !(await verifyGitHubSignature(raw, secret, req.headers.get('X-Hub-Signature-256') || ''))) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (req.headers.get('X-GitHub-Event') !== 'pull_request') return json({ ok: true, ignored: true });
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return json({ error: 'JSON invalide' }, 400);
      }
      const branch: string = payload?.pull_request?.head?.ref || '';
      const m = branch.match(/^review\/marque-([a-z2-9]{8})$/);
      if (!m) return json({ ok: true, ignored: true });
      const code = m[1].toUpperCase();
      const prUrl = typeof payload?.pull_request?.html_url === 'string' ? payload.pull_request.html_url : '';
      const now = new Date().toISOString();
      const action = payload?.action;
      if (action === 'opened' || action === 'reopened') {
        await env.DB
          .prepare(`UPDATE submissions SET status = 'accepted', review_notes = ?, updated_at = ? WHERE code = ?`)
          .bind(`PR: ${prUrl}`, now, code)
          .run();
      } else if (action === 'closed' && payload?.pull_request?.merged) {
        await env.DB
          .prepare(`UPDATE submissions SET status = 'published', review_notes = ?, updated_at = ? WHERE code = ?`)
          .bind(`PR mergée : ${prUrl}`, now, code)
          .run();
      } else if (action === 'closed') {
        await env.DB
          .prepare(`UPDATE submissions SET status = 'rejected', review_notes = ?, updated_at = ? WHERE code = ?`)
          .bind(`PR fermée sans merge : ${prUrl}`, now, code)
          .run();
      }
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },
};

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

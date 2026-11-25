/// <reference types="node" />
/**
 * Tests du worker de soumissions via Miniflare (D1 + KV réels, locaux) :
 * soumission anonyme → code 8 car. → statut pending ; rate limit ; rejet invisible
 * publiquement ; accept → URL de PR préremplie ; page publique sans données perso.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, createFetchMock } from 'miniflare';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Pré-bundle du worker TS → JS (Miniflare charge ensuite du JS pur).
// Le fichier est écrit DANS le projet : workerd refuse les chemins qui remontent
// au-dessus du répertoire de départ (modulesRoot).
const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as typeof import('esbuild');
const outdir = path.resolve(import.meta.dirname, '.tmp');
fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, 'index.mjs');
esbuild.buildSync({
  entryPoints: [path.resolve(import.meta.dirname, '../src/index.ts')],
  bundle: true,
  outfile,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});

const mf = new Miniflare({
  scriptPath: outfile,
  modulesRoot: outdir,
  modules: true,
  d1Databases: ['DB'],
  kvNamespaces: ['RATE_KV'],
  bindings: {
    REVIEW_SECRET: 'test-secret',
    GITHUB_WEBHOOK_SECRET: 'whsec',
    GIT_PROVIDER: 'github',
    GIT_WEB_BASE_URL: 'https://github.com/EcoCyclea/ecocyclea-content',
    RATE_LIMIT_PER_HOUR: '3',
  },
});

before(async () => {
  await mf.ready;
});

after(async () => {
  await mf.dispose();
});

const TOKEN = 'a'.repeat(32);

function postSubmission(overrides: Record<string, unknown> = {}, token = TOKEN) {
  return mf.dispatchFetch('http://worker.test/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Marque Test',
      url: 'https://marque-test.fr',
      category: 'culottes-menstruelles',
      reason: 'Coton bio certifié GOTS et fabrication en France, preuves sur leur site.',
      antiSpamToken: token,
      ...overrides,
    }),
  });
}

test('POST /submissions → 201 + code de 8 caractères + statut pending', async () => {
  const res = await postSubmission();
  assert.equal(res.status, 201);
  const body = await res.json() as any;
  assert.match(body.code, /^[A-Z2-9]{8}$/);
  assert.equal(body.status, 'pending');

  const statusRes = await mf.dispatchFetch(`http://worker.test/submissions/${body.code}`);
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json() as any;
  assert.equal(statusBody.status, 'pending');
  assert.equal(statusBody.code, body.code);
  // aucune donnée personnelle exposée
  assert.deepEqual(Object.keys(statusBody).sort(), ['code', 'status', 'updatedAt']);
});

test('validation : url non-HTTPS, catégorie invalide, raison trop courte → 422', async () => {
  assert.equal((await postSubmission({ url: 'http://x.fr' })).status, 422);
  assert.equal((await postSubmission({ category: 'invalide' })).status, 422);
  assert.equal((await postSubmission({ reason: 'court' })).status, 422);
  assert.equal((await postSubmission({ antiSpamToken: 'x' })).status, 422);
});

test('rate limit : 3 soumissions/heure puis 429', async () => {
  const token = 'b'.repeat(32);
  for (let i = 0; i < 3; i++) {
    const res = await postSubmission({}, token);
    assert.equal(res.status, 201, `soumission ${i + 1}`);
  }
  const res = await postSubmission({}, token);
  assert.equal(res.status, 429);
});

test('GET /submissions/:code inconnu → 404', async () => {
  const res = await mf.dispatchFetch('http://worker.test/submissions/ZZZZZZZZ');
  assert.equal(res.status, 404);
});

test('cycle de revue : accept → PR préremplie ; reject → jamais publié ; publish → visible publiquement', async () => {
  // soumettre
  const res = await postSubmission({ name: 'Marque Revue', url: 'https://revue.fr' });
  const { code } = await res.json() as any;
  const row = await (await mf.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json() as any;
  const sub = row.submissions.find((s: any) => s.code === code);
  assert.ok(sub);
  assert.equal(sub.status, 'pending');

  // mauvaise secret → 401
  assert.equal((await mf.dispatchFetch('http://worker.test/review/api/queue?secret=wrong')).status, 401);

  // accept → prUrl préremplie pointant vers le dépôt de contenu
  const acceptRes = await mf.dispatchFetch(`http://worker.test/review/accept/${sub.id}?secret=test-secret`, { method: 'POST' });
  assert.equal(acceptRes.status, 200);
  const { prUrl } = await acceptRes.json() as any;
  const prUrlDecoded = decodeURIComponent(prUrl.replace(/\+/g, ' ')); // URLSearchParams encode les espaces en '+'
  assert.ok(prUrl.includes('github.com/EcoCyclea/ecocyclea-content/compare/'));
  assert.ok(prUrlDecoded.includes('content/brands/brands.fr-FR.json'));
  assert.ok(prUrlDecoded.includes('Marque Revue'));

  // statut maintenant accepted
  const st = await (await mf.dispatchFetch(`http://worker.test/submissions/${code}`)).json() as any;
  assert.equal(st.status, 'accepted');

  // publish → visible sur la page publique
  await mf.dispatchFetch(`http://worker.test/review/publish/${sub.id}?secret=test-secret`, { method: 'POST' });
  const home = await mf.dispatchFetch('http://worker.test/');
  const homeText = await home.text();
  assert.ok(homeText.includes('Marque Revue'));
  assert.ok(!homeText.includes(TOKEN)); // jamais de jeton

  // une soumission rejetée n'apparaît nulle part côté public
  const res2 = await postSubmission({ name: 'Marque Rejetée', url: 'https://rejetee.fr' }, 'c'.repeat(32));
  const { code: code2 } = await res2.json() as any;
  const row2 = await (await mf.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json() as any;
  const sub2 = row2.submissions.find((s: any) => s.code === code2);
  await mf.dispatchFetch(`http://worker.test/review/reject/${sub2.id}?secret=test-secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Preuves insuffisantes (greenwashing non documenté)' }),
  });
  const st2 = await (await mf.dispatchFetch(`http://worker.test/submissions/${code2}`)).json() as any;
  assert.equal(st2.status, 'rejected');
  const home2 = await (await mf.dispatchFetch('http://worker.test/')).text();
  assert.ok(!home2.includes('Marque Rejetée'));
});

test('POST /reports → file de revue (signalement de marque)', async () => {
  const res = await mf.dispatchFetch('http://worker.test/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'brand-report',
      brandSlug: 'marque-test',
      message: 'Informations obsolètes sur cette marque.',
      antiSpamToken: 'd'.repeat(32),
    }),
  });
  assert.equal(res.status, 201);
  const row = await (await mf.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json() as any;
  assert.ok(row.reports.some((r: any) => r.brand_slug === 'marque-test'));
});

test('CORS preflight OK', async () => {
  const res = await mf.dispatchFetch('http://worker.test/submissions', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('prefilledPrUrl supporte GitLab (GIT_PROVIDER=gitlab)', async (t) => {
  const { Miniflare: MF } = await import('miniflare');
  const mf2 = new MF({
    scriptPath: outfile,
    modulesRoot: outdir,
    modules: true,
    d1Databases: ['DB'],
    kvNamespaces: ['RATE_KV'],
    bindings: {
      REVIEW_SECRET: 'test-secret',
      GIT_PROVIDER: 'gitlab',
      GIT_WEB_BASE_URL: 'https://gitlab.com/ecocyclea/ecocyclea-content',
      RATE_LIMIT_PER_HOUR: '50',
    },
  });
  // Toujours libérer workerd, même si une assertion échoue (sinon le process hang).
  t.after(() => mf2.dispose());
  await mf2.ready;
  const res = await mf2.dispatchFetch('http://worker.test/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Marque GitLab', url: 'https://gl.fr', category: 'zero-dechet',
      reason: 'Test du fournisseur GitLab pour la PR préremplie.',
      antiSpamToken: 'e'.repeat(32),
    }),
  });
  const { code } = (await res.json()) as any;
  const queue = (await (await mf2.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json()) as any;
  const sub = queue.submissions.find((s: any) => s.code === code);
  const accept = await mf2.dispatchFetch(`http://worker.test/review/accept/${sub.id}?secret=test-secret`, { method: 'POST' });
  const { prUrl } = (await accept.json()) as any;
  assert.ok(prUrl.startsWith('https://gitlab.com/ecocyclea/ecocyclea-content/-/merge_requests/new?'));
  // URLSearchParams encode les espaces en '+' : decodeURIComponent seul ne suffit pas.
  const decoded = decodeURIComponent(prUrl.replaceAll('+', ' '));
  assert.ok(decoded.includes('Marque GitLab'), `titre MR attendu dans ${prUrl}`);
});

test('accept avec GITHUB_TOKEN → la PR est créée via l’API GitHub (branche + commit + PR)', async (t) => {
  // Mock de l'API GitHub (undici MockAgent injecté dans Miniflare)
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const gh = fetchMock.get('https://api.github.com');
  const mf3 = new Miniflare({
    scriptPath: outfile,
    modulesRoot: outdir,
    modules: true,
    d1Databases: ['DB'],
    kvNamespaces: ['RATE_KV'],
    fetchMock,
    bindings: {
      REVIEW_SECRET: 'test-secret',
      GIT_PROVIDER: 'github',
      GIT_WEB_BASE_URL: 'https://github.com/EcoCyclea/ecocyclea-content',
      GITHUB_TOKEN: 'ghp_test',
      RATE_LIMIT_PER_HOUR: '50',
    },
  });
  t.after(() => mf3.dispose());
  await mf3.ready;

  const R = '/repos/EcoCyclea/ecocyclea-content';
  // Le 1er POST /pulls échoue (500) : la soumission reste 'pending' (pas de PR auto),
  // puis /review/accept rejoue la création de PR qui réussit cette fois.
  gh.intercept({ path: `${R}/git/refs/heads/main`, method: 'GET' })
    .reply(200, { object: { sha: 'main-sha' } }, { headers: { 'content-type': 'application/json' } }).persist();
  gh.intercept({ path: `${R}/git/refs`, method: 'POST' })
    .reply(201, { ref: 'refs/heads/review/marque-x' }, { headers: { 'content-type': 'application/json' } }).persist();
  const brandsFile = Buffer.from(JSON.stringify({ rubricVersion: '1.0', brands: [] })).toString('base64');
  gh.intercept({ path: new RegExp(`${R}/contents/content/brands/brands\\.fr-FR\\.json`) , method: 'GET' })
    .reply(200, { sha: 'file-sha', content: brandsFile }, { headers: { 'content-type': 'application/json' } }).persist();
  let putBody: any = null;
  gh.intercept({ path: `${R}/contents/content/brands/brands.fr-FR.json`, method: 'PUT' })
    .reply(201, async (opts) => {
      const text = await new Response(opts.body as any).text();
      putBody = JSON.parse(text);
      return { content: { sha: 'new-file-sha' } };
    }, { headers: { 'content-type': 'application/json' } }).persist();
  gh.intercept({ path: `${R}/pulls`, method: 'POST' })
    .reply(500, { message: 'boom' }, { headers: { 'content-type': 'application/json' } });
  gh.intercept({ path: `${R}/pulls`, method: 'POST' })
    .reply(201, { html_url: 'https://github.com/EcoCyclea/ecocyclea-content/pull/42' }, { headers: { 'content-type': 'application/json' } });

  // Soumission (PR auto échoue → pending) puis accept (PR créée)
  const res = await mf3.dispatchFetch('http://worker.test/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Marque API', url: 'https://api.fr', category: 'coupe-menstruelle',
      reason: 'Test de création de PR via l’API GitHub.',
      antiSpamToken: 'f'.repeat(32),
    }),
  });
  const { code } = (await res.json()) as any;
  const queue = (await (await mf3.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json()) as any;
  const sub = queue.submissions.find((s: any) => s.code === code);
  const accept = await mf3.dispatchFetch(`http://worker.test/review/accept/${sub.id}?secret=test-secret`, { method: 'POST' });
  assert.equal(accept.status, 200);
  const body = (await accept.json()) as any;
  assert.equal(body.prCreated, true);
  assert.equal(body.prUrl, 'https://github.com/EcoCyclea/ecocyclea-content/pull/42');

  // Le commit sur la branche contient bien l'entrée de la marque
  assert.ok(putBody, 'PUT contents appelé');
  assert.equal(putBody.branch, `review/marque-${code.toLowerCase()}`);
  const committed = JSON.parse(Buffer.from(putBody.content, 'base64').toString('utf8'));
  assert.equal(committed.brands.length, 1);
  assert.equal(committed.brands[0].name, 'Marque API');
  assert.equal(committed.brands[0].id, `brand-sub-${code.toLowerCase()}`);
});

function githubWebhookRequest(mfInstance: Miniflare, payload: unknown, secret = 'whsec', event = 'pull_request') {
  return import('node:crypto').then(({ createHmac }) => {
    const raw = JSON.stringify(payload);
    const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    return mfInstance.dispatchFetch('http://worker.test/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-Hub-Signature-256': sig,
      },
      body: raw,
    });
  });
}

function prPayload(action: string, code: string, merged = false) {
  const c = code.toLowerCase();
  return {
    action,
    pull_request: {
      html_url: `https://github.com/EcoCyclea/ecocyclea-content/pull/7`,
      merged,
      head: { ref: `review/marque-${c}` },
    },
  };
}

test('webhook GitHub : opened → accepted, merged → published, closed sans merge → rejected, mauvaise signature → 401', async () => {
  const { createHmac } = await import('node:crypto');

  // deux soumissions (sans GITHUB_TOKEN sur ce mf → restent pending)
  const r1 = await postSubmission({ name: 'Marque WH1', url: 'https://wh1.fr' }, 'g'.repeat(32));
  const { code: c1 } = (await r1.json()) as any;
  const r2 = await postSubmission({ name: 'Marque WH2', url: 'https://wh2.fr' }, 'h'.repeat(32));
  const { code: c2 } = (await r2.json()) as any;
  const r3 = await postSubmission({ name: 'Marque WH3', url: 'https://wh3.fr' }, 'i'.repeat(32));
  const { code: c3 } = (await r3.json()) as any;

  const statusOf = async (code: string) =>
    ((await (await mf.dispatchFetch(`http://worker.test/submissions/${code}`)).json()) as any).status;
  assert.equal(await statusOf(c1), 'pending');

  // signature invalide → 401
  const raw = JSON.stringify(prPayload('opened', c1));
  const bad = await mf.dispatchFetch('http://worker.test/webhooks/github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': 'sha256=deadbeef' },
    body: raw,
  });
  assert.equal(bad.status, 401);
  assert.equal(await statusOf(c1), 'pending');

  // opened → accepted
  assert.equal((await githubWebhookRequest(mf, prPayload('opened', c1))).status, 200);
  assert.equal(await statusOf(c1), 'accepted');

  // closed + merged → published
  assert.equal((await githubWebhookRequest(mf, prPayload('closed', c1, true))).status, 200);
  assert.equal(await statusOf(c1), 'published');

  // closed sans merge → rejected
  await githubWebhookRequest(mf, prPayload('opened', c2));
  assert.equal((await githubWebhookRequest(mf, prPayload('closed', c2, false))).status, 200);
  assert.equal(await statusOf(c2), 'rejected');

  // branche inconnue → ignoré, 200
  assert.equal((await githubWebhookRequest(mf, prPayload('opened', 'ZZZZZZZZ'))).status, 200);

  // autre event → ignoré
  assert.equal((await githubWebhookRequest(mf, { zen: true }, 'whsec', 'ping')).status, 200);

  // c3 non touché
  assert.equal(await statusOf(c3), 'pending');

  // review_notes trace la PR
  const queue = (await (await mf.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json()) as any;
  const s1 = queue.submissions.find((s: any) => s.code === c1);
  assert.ok(s1.review_notes.includes('PR mergée'), `review_notes: ${s1.review_notes}`);
});

test('soumission avec GITHUB_TOKEN → PR créée automatiquement, statut accepted', async (t) => {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const gh = fetchMock.get('https://api.github.com');
  const R = '/repos/EcoCyclea/ecocyclea-content';
  gh.intercept({ path: `${R}/git/refs/heads/main`, method: 'GET' })
    .reply(200, { object: { sha: 'main-sha' } }, { headers: { 'content-type': 'application/json' } });
  gh.intercept({ path: `${R}/git/refs`, method: 'POST' })
    .reply(201, {}, { headers: { 'content-type': 'application/json' } });
  const brandsFile = Buffer.from(JSON.stringify({ rubricVersion: '1.0', brands: [] })).toString('base64');
  gh.intercept({ path: new RegExp(`${R}/contents/content/brands/brands\\.fr-FR\\.json`), method: 'GET' })
    .reply(200, { sha: 'file-sha', content: brandsFile }, { headers: { 'content-type': 'application/json' } });
  gh.intercept({ path: `${R}/contents/content/brands/brands.fr-FR.json`, method: 'PUT' })
    .reply(201, { content: { sha: 'new-sha' } }, { headers: { 'content-type': 'application/json' } });
  gh.intercept({ path: `${R}/pulls`, method: 'POST' })
    .reply(201, { html_url: 'https://github.com/EcoCyclea/ecocyclea-content/pull/99' }, { headers: { 'content-type': 'application/json' } });

  const mf4 = new Miniflare({
    scriptPath: outfile,
    modulesRoot: outdir,
    modules: true,
    d1Databases: ['DB'],
    kvNamespaces: ['RATE_KV'],
    fetchMock,
    bindings: {
      REVIEW_SECRET: 'test-secret',
      GITHUB_WEBHOOK_SECRET: 'whsec',
      GIT_PROVIDER: 'github',
      GIT_WEB_BASE_URL: 'https://github.com/EcoCyclea/ecocyclea-content',
      GITHUB_TOKEN: 'ghp_test',
      RATE_LIMIT_PER_HOUR: '50',
    },
  });
  t.after(() => mf4.dispose());
  await mf4.ready;

  const res = await mf4.dispatchFetch('http://worker.test/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Marque AutoPR', url: 'https://autopr.fr', category: 'zero-dechet',
      reason: 'Test de création automatique de PR à la soumission.',
      antiSpamToken: 'j'.repeat(32),
    }),
  });
  assert.equal(res.status, 201);
  const { code, status } = (await res.json()) as any;
  assert.equal(status, 'accepted');

  // statut relu par l'app
  const st = (await (await mf4.dispatchFetch(`http://worker.test/submissions/${code}`)).json()) as any;
  assert.equal(st.status, 'accepted');

  // review_notes contient l'URL de la PR
  const queue = (await (await mf4.dispatchFetch('http://worker.test/review/api/queue?secret=test-secret')).json()) as any;
  const sub = queue.submissions.find((s: any) => s.code === code);
  assert.ok(sub.review_notes.includes('pull/99'), `review_notes: ${sub.review_notes}`);
});

import { Miniflare } from 'miniflare';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/');
const esbuild = require('esbuild');
const outdir = path.resolve('test/.tmp'); fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, 'index.mjs');
esbuild.buildSync({ entryPoints: [path.resolve('src/index.ts')], bundle: true, outfile, format: 'esm', platform: 'neutral', target: 'es2022' });
const mf = new Miniflare({
  scriptPath: outfile, modulesRoot: outdir, modules: true,
  d1Databases: ['DB'], kvNamespaces: ['RATE_KV'],
  bindings: { REVIEW_SECRET: 'demo-secret', GITHUB_REPO: 'ecocyclea/ecocyclea-content', RATE_LIMIT_PER_HOUR: '5' },
});
await mf.ready;
const base = 'http://localhost';
let res = await mf.dispatchFetch(base + '/submissions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Dans Ma Culotte', url: 'https://dansmaculotte.com', category: 'culottes-menstruelles', reason: 'Coton bio GOTS, fabrication en France, preuves publiques sur leur site.', antiSpamToken: 'demo' + 'a'.repeat(28) }),
});
const body = await res.json();
console.log('POST /submissions →', res.status, JSON.stringify(body));
res = await mf.dispatchFetch(base + '/submissions/' + body.code);
console.log('GET /submissions/' + body.code, '→', res.status, JSON.stringify(await res.json()));
res = await mf.dispatchFetch(base + '/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', url: 'http://x.fr', category: 'nope', reason: 'court', antiSpamToken: 'x' }) });
console.log('POST invalide →', res.status, JSON.stringify(await res.json()));
await mf.dispose();

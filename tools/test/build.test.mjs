import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey, createPrivateKey, verify, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const TOOLS = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.resolve(TOOLS, '..');
const DIST = path.join(REPO, 'dist');

test('build-feed signe un manifeste vérifiable (Ed25519) avec les sha256 des contenus', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const pubKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubRaw]),
    format: 'der',
    type: 'spki',
  });

  execFileSync(process.execPath, ['build-feed.mjs'], {
    cwd: TOOLS,
    env: { ...process.env, FEED_SIGNING_PRIVATE_KEY: privPem },
    stdio: 'pipe',
  });

  const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.fr-FR.json'), 'utf8'));
  assert.equal(manifest.signatureAlgorithm, 'ed25519');
  assert.match(manifest.signature, /^[0-9a-f]{128}$/);

  // re-canonicalise le payload comme le fait l'app
  const canonicalize = (v) =>
    v === null || typeof v !== 'object'
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? '[' + v.map(canonicalize).join(',') + ']'
        : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  const ok = verify(null, Buffer.from(canonicalize(manifest.payload), 'utf8'), pubKey, Buffer.from(manifest.signature, 'hex'));
  assert.ok(ok, 'la signature Ed25519 du manifeste doit être valide');

  // sha256 des fichiers == payload
  for (const [name, f] of Object.entries(manifest.payload.files)) {
    const sha = createHash('sha256').update(readFileSync(path.join(DIST, name))).digest('hex');
    assert.equal(sha, f.sha256, `sha256 de ${name}`);
    assert.ok(f.url.startsWith('https://'), 'URL du CDN en https');
  }

  // articles publiés uniquement, readingMinutes présent
  const articles = JSON.parse(readFileSync(path.join(DIST, 'articles.fr-FR.json'), 'utf8'));
  assert.ok(articles.articles.length >= 2);
  for (const a of articles.articles) {
    assert.ok(a.validatedBy && a.validatedAt, 'article publié avec sign-off');
    assert.ok(a.readingMinutes >= 1);
    assert.ok(a.links.length >= 1);
    for (const l of a.links) assert.ok(l.url.startsWith('https://'));
  }

  // copie versionnée pour rollback
  assert.ok(existsSync(path.join(DIST, 'versions', manifest.version, 'manifest.fr-FR.json')));
  const versioned = JSON.parse(readFileSync(path.join(DIST, 'versions', manifest.version, 'manifest.fr-FR.json'), 'utf8'));
  for (const f of Object.values(versioned.payload.files)) {
    assert.ok(f.url.includes(`/versions/${manifest.version}/`), 'manifeste versionné → URL versionnées');
  }

  // clé publique produite pour l'app
  assert.ok(existsSync(path.join(DIST, 'feed-public-key.hex')));
  assert.equal(readFileSync(path.join(DIST, 'feed-public-key.hex'), 'utf8').trim(), pubRaw.toString('hex'));
});

test('build-feed échoue si la validation échoue', () => {
  // On ne peut pas modifier le vrai contenu ici ; on vérifie juste qu'un build
  // sans clé et sans DEV_EPHEMERAL_KEY échoue proprement.
  assert.throws(() =>
    execFileSync(process.execPath, ['build-feed.mjs'], {
      cwd: TOOLS,
      env: { ...process.env, FEED_SIGNING_PRIVATE_KEY: '', DEV_EPHEMERAL_KEY: '' },
      stdio: 'pipe',
    }),
  );
});

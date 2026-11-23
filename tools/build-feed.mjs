#!/usr/bin/env node
/**
 * build-feed.mjs — construit le flux signé :
 *   dist/manifest.fr-FR.json        (payload + signature Ed25519 détachée)
 *   dist/articles.fr-FR.json         (articles publiés, readingMinutes auto)
 *   dist/brands.fr-FR.json
 *   dist/versions/<version>/…        (copie horodatée pour rollback)
 *
 * Signature : Ed25519 sur le JSON canonique du payload {version, files:{…url,sha256}}.
 * Clé privée : env FEED_SIGNING_PRIVATE_KEY (PKCS8 PEM, secret CI).
 * Sur les PR (sans secret) : DEV_EPHEMERAL_KEY=1 génère une clé éphémère (test du pipeline uniquement).
 *
 * Upload (CI, branche main) : tools/ + workflow → s3://$S3_BUCKET/feeds/fr-FR/latest/…
 * et …/versions/<version>/… (voir .github/workflows/content.yml).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAll } from './validate.mjs';
import { parseArticleFile, computeReadingMinutes } from './lib/frontmatter.mjs';
import { canonicalize } from './lib/canonical.mjs';
import { signPayload, publicKeyHexFromPrivate, generateEphemeralKeyPair } from './lib/sig.mjs';
import { REPO_ROOT as ROOT, CONTENT_DIR, DIST_DIR, LOCALE, RUBRIC_VERSION, feedUrl } from './lib/repo.mjs';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function main() {
  // 1. Validation obligatoire avant tout build
  const { errors, warnings } = validateAll(ROOT);
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length > 0) {
    console.error('❌ Build annulé : validation échouée :');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const version = new Date().toISOString();
  const generatedAt = version;

  // 2. Articles publiés → articles.fr-FR.json
  const articles = [];
  for (const file of walk(path.join(CONTENT_DIR, 'health')).filter((f) => f.endsWith('.md'))) {
    const { data, body } = parseArticleFile(file);
    if (data.status !== 'published') continue; // draft/retracted exclus du flux
    articles.push({
      id: data.id,
      slug: data.slug,
      category: data.category,
      title: data.title,
      summary: data.summary,
      readingMinutes: computeReadingMinutes(body), // toujours la valeur calculée
      body,
      tags: data.tags ?? [],
      spotlight: data.spotlight ?? false,
      links: data.links,
      validatedBy: data.validatedBy,
      validatedByTitle: data.validatedByTitle,
      validatedAt: data.validatedAt,
      publishedAt: data.publishedAt,
    });
  }
  articles.sort((a, b) => (a.spotlight === b.spotlight ? b.publishedAt.localeCompare(a.publishedAt) : a.spotlight ? -1 : 1));

  const brandsDoc = JSON.parse(readFileSync(path.join(CONTENT_DIR, 'brands', `brands.${LOCALE}.json`), 'utf8'));

  const articlesFeed = { version, locale: LOCALE, generatedAt, rubricVersion: RUBRIC_VERSION, articles };
  const brandsFeed = { version, locale: LOCALE, generatedAt, rubricVersion: brandsDoc.rubricVersion, brands: brandsDoc.brands };

  // 3. Écriture des fichiers de contenu + sha256
  mkdirSync(DIST_DIR, { recursive: true });
  const files = {};
  for (const [name, doc] of [
    [`articles.${LOCALE}.json`, articlesFeed],
    [`brands.${LOCALE}.json`, brandsFeed],
  ]) {
    const buf = Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8');
    files[name] = { url: feedUrl(LOCALE, name, 'latest'), sha256: sha256(buf), bytes: buf.length };
    writeFileSync(path.join(DIST_DIR, name), buf);
  }

  // 4. Payload + signature
  const payload = { version, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { url: v.url, sha256: v.sha256 }])) };
  let privateKeyPem = process.env.FEED_SIGNING_PRIVATE_KEY;
  let keyId;
  if (!privateKeyPem) {
    if (process.env.DEV_EPHEMERAL_KEY === '1') {
      const ephemeral = generateEphemeralKeyPair();
      privateKeyPem = ephemeral.privateKeyPem;
      keyId = `dev-ephemeral-${ephemeral.publicKeyHex.slice(0, 12)}`;
      console.warn('⚠️  DEV_EPHEMERAL_KEY=1 : signature avec une clé éphémère — NE PAS PUBLIER.');
    } else {
      console.error('❌ FEED_SIGNING_PRIVATE_KEY manquant (ou DEV_EPHEMERAL_KEY=1 pour un build de test)');
      process.exit(1);
    }
  } else {
    keyId = `feed-key-${publicKeyHexFromPrivate(privateKeyPem).slice(0, 12)}`;
  }
  const signature = signPayload(payload, privateKeyPem);
  const manifest = {
    version,
    generatedAt,
    locale: LOCALE,
    signatureAlgorithm: 'ed25519',
    keyId,
    signature,
    payload,
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(DIST_DIR, `manifest.${LOCALE}.json`), manifestBuf);

  // 5. Copie horodatée pour rollback : dist/versions/<version>/…
  const versionDir = path.join(DIST_DIR, 'versions', version);
  mkdirSync(versionDir, { recursive: true });
  for (const name of [...Object.keys(files), `manifest.${LOCALE}.json`]) {
    copyFileSync(path.join(DIST_DIR, name), path.join(versionDir, name));
  }
  // Manifeste de la version archive pointe vers les URL versionnées (rollback instantané)
  const versionedManifest = structuredClone(manifest);
  for (const name of Object.keys(versionedManifest.payload.files)) {
    versionedManifest.payload.files[name].url = feedUrl(LOCALE, name, version);
  }
  writeFileSync(path.join(versionDir, `manifest.${LOCALE}.json`), JSON.stringify(versionedManifest, null, 2) + '\n');

  // 6.empreinte de la clé publique (à épingler dans l'app)
  if (process.env.FEED_SIGNING_PRIVATE_KEY) {
    writeFileSync(path.join(DIST_DIR, 'feed-public-key.hex'), publicKeyHexFromPrivate(privateKeyPem) + '\n');
  }

  console.log(`✅ Flux construit : version=${version}`);
  console.log(`   keyId=${keyId}`);
  console.log(`   articles publiés: ${articles.length}`);
  console.log(`   marques: ${brandsFeed.brands.length}`);
  for (const [name, f] of Object.entries(files)) {
    console.log(`   ${name}: ${f.bytes} octets, sha256=${f.sha256.slice(0, 16)}… → ${f.url}`);
  }
  console.log(`   manifeste: dist/manifest.${LOCALE}.json (signé, ${signature.slice(0, 16)}…)`);
  console.log(`   rollback:  dist/versions/${version}/`);
}

main();

#!/usr/bin/env node
/**
 * verify-dist.mjs — vérifie localement un dist/ produit par build-feed.mjs :
 * la signature Ed25519 du manifeste est valide pour la clé publique attendue
 * (env FEED_PUBLIC_KEY_HEX, ou dérivée de FEED_SIGNING_PRIVATE_KEY), et les
 * sha256 des fichiers de contenu correspondent au payload.
 */
import { createPublicKey, verify as cryptoVerify, createPrivateKey, createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { canonicalize } from './lib/canonical.mjs';
import { DIST_DIR } from './lib/repo.mjs';

let pubHex = process.env.FEED_PUBLIC_KEY_HEX;
if (!pubHex && process.env.FEED_SIGNING_PRIVATE_KEY) {
  const pubDer = createPublicKey(createPrivateKey(process.env.FEED_SIGNING_PRIVATE_KEY))
    .export({ type: 'spki', format: 'der' });
  pubHex = pubDer.subarray(-32).toString('hex');
}
if (!pubHex) {
  console.error('❌ FEED_PUBLIC_KEY_HEX ou FEED_SIGNING_PRIVATE_KEY requis');
  process.exit(1);
}
// Reconstruit une clé publique SPKI à partir des 32 octets bruts
const prefix = Buffer.from('302a300506032b6570032100', 'hex');
const pubKey = createPublicKey({ key: Buffer.concat([prefix, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' });

const manifest = JSON.parse(readFileSync(path.join(DIST_DIR, 'manifest.fr-FR.json'), 'utf8'));
const okSig = cryptoVerify(
  null,
  Buffer.from(canonicalize(manifest.payload), 'utf8'),
  pubKey,
  Buffer.from(manifest.signature, 'hex'),
);
if (!okSig) {
  console.error('❌ Signature du manifeste INVALIDE');
  process.exit(1);
}
console.log(`✅ Signature Ed25519 valide (clé ${pubHex.slice(0, 16)}…)`);

let allOk = true;
for (const [name, f] of Object.entries(manifest.payload.files)) {
  const buf = readFileSync(path.join(DIST_DIR, name));
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== f.sha256) {
    console.error(`❌ sha256 mismatch pour ${name}`);
    allOk = false;
  } else {
    console.log(`✅ ${name}: sha256 OK`);
  }
}
process.exit(allOk ? 0 : 1);

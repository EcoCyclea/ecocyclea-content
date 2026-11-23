#!/usr/bin/env node
/**
 * keygen.mjs — génère une paire de clés Ed25519 pour le flux de contenu.
 *
 *   node keygen.mjs --out-dir .secrets/
 *
 * Produit :
 *   feed-signing-private.pem  → secret GitHub `FEED_SIGNING_PRIVATE_KEY` (NE JAMAIS COMMITTER)
 *   feed-signing-public.hex   → clé publique brute (32 octets, hex) à ÉPINGLER dans l'app
 *   feed-signing-public.pem   → clé publique SPKI (pour vérification externe)
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv.includes('--out-dir')
  ? path.resolve(process.argv[process.argv.indexOf('--out-dir') + 1])
  : path.resolve('.secrets');

mkdirSync(outDir, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const pubRawHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');

writeFileSync(path.join(outDir, 'feed-signing-private.pem'), privPem);
writeFileSync(path.join(outDir, 'feed-signing-public.pem'), pubPem);
writeFileSync(path.join(outDir, 'feed-signing-public.hex'), pubRawHex + '\n');

console.log(`✅ Paire générée dans ${outDir}`);
console.log(`   secret CI  FEED_SIGNING_PRIVATE_KEY = contenu de feed-signing-private.pem`);
console.log(`   clé épinglée dans l'app (hex)      = ${pubRawHex}`);
console.log('⚠️  Ne committez JAMAIS feed-signing-private.pem (voir .gitignore / OPERATIONS.md).');

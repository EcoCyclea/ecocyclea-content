import { createPrivateKey, createPublicKey, sign as cryptoSign, generateKeyPairSync } from 'node:crypto';
import { canonicalize } from './canonical.mjs';

/**
 * Signe le payload (Ed25519, signature détachée) avec une clé privée PKCS8 PEM.
 * Retourne la signature en hex (128 caractères).
 */
export function signPayload(payload, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  return cryptoSign(null, Buffer.from(canonicalize(payload), 'utf8'), key).toString('hex');
}

/** Clé publique brute (32 octets, hex = 64 caractères) dérivée d'une clé privée PEM. */
export function publicKeyHexFromPrivate(privateKeyPem) {
  const pub = createPublicKey(createPrivateKey(privateKeyPem));
  const raw = pub.export({ type: 'spki', format: 'der' });
  // SPKI Ed25519 : 12 octets d'en-tête + 32 octets de clé brute
  return raw.subarray(raw.length - 32).toString('hex');
}

/** Génère une paire Ed25519 éphémère (builds PR de CI sans secret). */
export function generateEphemeralKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyHex: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
  };
}

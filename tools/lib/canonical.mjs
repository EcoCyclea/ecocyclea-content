/**
 * Sérialisation JSON canonique (clés triées récursivement) utilisée comme
 * octets signés par Ed25519. Toute implémentation (CI Node, app) doit produire
 * exactement la même chaîne pour un même objet.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') +
    '}'
  );
}

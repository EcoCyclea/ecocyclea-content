#!/usr/bin/env node
/**
 * purge-cdn.mjs — purge optionnelle du cache Cloudflare après publication.
 * Variables requises : CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CDN_BASE_URL.
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const zone = process.env.CLOUDFLARE_ZONE_ID;
const base = (process.env.CDN_BASE_URL || '').replace(/\/+$/, '');
if (!token || !zone || !base) {
  console.warn('⚠️  Purge CDN ignorée : CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID / CDN_BASE_URL manquants');
  process.exit(0);
}
const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefixes: [`${base}/feeds/`] }),
});
if (!res.ok) {
  console.error(`❌ Purge Cloudflare échouée: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log('✅ Cache CDN purgé pour', `${base}/feeds/`);

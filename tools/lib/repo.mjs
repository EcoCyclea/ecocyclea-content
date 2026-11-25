import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TOOLS_DIR, '..', '..');

export const CONTENT_DIR = path.join(REPO_ROOT, 'content');
export const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas');
// Dist surchargeable (FEED_DIST_DIR) pour que les tests ne écrasent pas un vrai build local
export const DIST_DIR = process.env.FEED_DIST_DIR
  ? path.resolve(process.env.FEED_DIST_DIR)
  : path.join(REPO_ROOT, 'dist');
export const DOCS_DIR = path.join(REPO_ROOT, 'docs');

export const LOCALE = 'fr-FR';
export const RUBRIC_VERSION = '1.0';
export const STALENESS_MONTHS = 12;
export const WORDS_PER_MINUTE = 200;
export const MIN_PUBLISH_SCORE = 60;

export const HEALTH_CATEGORIES = [
  'mon-cycle',
  'contraception',
  'depistage-prevention',
  'ist',
  'endometriose',
  'fertilite-grossesse',
  'menopause',
];

export const BRAND_CATEGORIES = [
  'culottes-menstruelles',
  'coupe-menstruelle',
  'tampons-serviettes-bio',
  'zero-dechet',
  'lingerie-soins',
];

/** URL de base du CDN (sans slash final). Alimentée par la CI via CDN_BASE_URL. */
export const CDN_BASE_URL =
  (process.env.CDN_BASE_URL || 'https://cdn.ecocyclea.fr').replace(/\/+$/, '');

export function feedUrl(locale, name, version = 'latest') {
  const segment = version === 'latest' ? 'latest' : `versions/${version}`;
  return `${CDN_BASE_URL}/feeds/${locale}/${segment}/${name}`;
}

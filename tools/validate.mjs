#!/usr/bin/env node
/**
 * validate.mjs — valide tout le contenu du repo :
 *  - frontmatter des articles vs schemas/article.frontmatter.schema.json
 *  - brands.fr-FR.json vs schemas/brands.schema.json
 *  - règles éditoriales : status=published ⇒ validatedBy/validatedAt + ≥1 lien ;
 *    liens en HTTPS uniquement ; catégories et labels dans les listes blanches ;
 *    readingMinutes (si présent) == valeur auto-calculée ; score ≥ 60 et cohérent
 *    avec rubricVersion ; id/slug uniques ; slug == nom de fichier ; catégorie == dossier.
 *
 * Usage : node validate.mjs   (exit 1 si erreurs)
 * Export : validateAll({ root }) → { errors: string[], warnings: string[] }
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  REPO_ROOT,
  HEALTH_CATEGORIES,
  BRAND_CATEGORIES,
  RUBRIC_VERSION,
  MIN_PUBLISH_SCORE,
} from './lib/repo.mjs';
import { parseArticleFile, computeReadingMinutes } from './lib/frontmatter.mjs';

function newAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateAll(root = REPO_ROOT) {
  const contentDir = path.join(root, 'content');
  const schemasDir = path.join(root, 'schemas');
  const errors = [];
  const warnings = [];
  const ajv = newAjv();

  const articleSchema = ajv.compile(
    JSON.parse(readFileSync(path.join(schemasDir, 'article.frontmatter.schema.json'), 'utf8')),
  );
  const brandsSchema = ajv.compile(
    JSON.parse(readFileSync(path.join(schemasDir, 'brands.schema.json'), 'utf8')),
  );
  const labelsCatalog = JSON.parse(
    readFileSync(path.join(schemasDir, 'labels.catalog.json'), 'utf8'),
  );
  const labelIds = new Set(labelsCatalog.labels.map((l) => l.id));

  // ---------- Articles ----------
  const seenIds = new Set();
  const seenSlugs = new Set();
  const healthDir = path.join(contentDir, 'health');
  const articleFiles = walk(healthDir).filter((f) => f.endsWith('.md'));

  for (const file of articleFiles) {
    const rel = path.relative(root, file);
    let parsed;
    try {
      parsed = parseArticleFile(file);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    const { data, body } = parsed;

    if (!articleSchema(data)) {
      for (const e of articleSchema.errors) errors.push(`${rel}: schéma frontmatter: ${e.instancePath || '/'} ${e.message}`);
      continue;
    }

    // Cohérence slug / nom de fichier / dossier catégorie
    const fileSlug = path.basename(file, '.md');
    if (data.slug !== fileSlug) errors.push(`${rel}: slug '${data.slug}' ≠ nom de fichier '${fileSlug}'`);
    const dirCategory = path.basename(path.dirname(file));
    if (!HEALTH_CATEGORIES.includes(dirCategory)) {
      errors.push(`${rel}: dossier de catégorie '${dirCategory}' hors liste blanche (${HEALTH_CATEGORIES.join(', ')})`);
    } else if (data.category !== dirCategory) {
      errors.push(`${rel}: category '${data.category}' ≠ dossier '${dirCategory}'`);
    }
    if (seenIds.has(data.id)) errors.push(`${rel}: id '${data.id}' en doublon`);
    if (seenSlugs.has(data.slug)) errors.push(`${rel}: slug '${data.slug}' en doublon`);
    seenIds.add(data.id);
    seenSlugs.add(data.slug);

    // Liens : HTTPS uniquement, pas d'identifiants dans l'URL
    data.links.forEach((link, i) => {
      if (!isHttpsUrl(link.url)) {
        errors.push(`${rel}: links[${i}].url '${link.url}' doit être une URL HTTPS valide sans identifiants`);
      }
    });

    // Règle éditoriale : publié ⇒ métadonnées de validation + au moins une source
    if (data.status === 'published') {
      if (!data.validatedBy || !data.validatedAt) {
        errors.push(`${rel}: status 'published' exige validatedBy et validatedAt (sign-off gynécologue)`);
      }
      if (!data.links || data.links.length < 1) {
        errors.push(`${rel}: un article publié exige au moins un lien de source vérifié`);
      }
      if (!isValidDate(data.publishedAt)) errors.push(`${rel}: publishedAt doit être AAAA-MM-JJ`);
      if (isValidDate(data.validatedAt) && isValidDate(data.publishedAt) && data.validatedAt > data.publishedAt) {
        errors.push(`${rel}: validatedAt (${data.validatedAt}) est postérieur à publishedAt (${data.publishedAt})`);
      }
    }
    if (data.validatedAt && !isValidDate(data.validatedAt)) {
      errors.push(`${rel}: validatedAt doit être au format AAAA-MM-JJ`);
    }

    // readingMinutes : s'il est renseigné, il doit correspondre au calcul auto
    const computed = computeReadingMinutes(body);
    if (data.readingMinutes !== undefined && data.readingMinutes !== computed) {
      errors.push(
        `${rel}: readingMinutes=${data.readingMinutes} mais le calcul automatique donne ${computed} min — corrigez ou retirez le champ`,
      );
    }
  }

  if (articleFiles.length === 0) warnings.push('Aucun article trouvé sous content/health/');

  // ---------- Marques ----------
  const brandsPath = path.join(contentDir, 'brands', 'brands.fr-FR.json');
  let brandsDoc = null;
  try {
    brandsDoc = JSON.parse(readFileSync(brandsPath, 'utf8'));
  } catch (err) {
    errors.push(`content/brands/brands.fr-FR.json: JSON invalide: ${err.message}`);
  }
  if (brandsDoc) {
    if (!brandsSchema(brandsDoc)) {
      for (const e of brandsSchema.errors) {
        errors.push(`brands.fr-FR.json: schéma: ${e.instancePath || '/'} ${e.message}`);
      }
    } else {
      if (brandsDoc.rubricVersion !== RUBRIC_VERSION) {
        errors.push(
          `brands.fr-FR.json: rubricVersion '${brandsDoc.rubricVersion}' ≠ version courante '${RUBRIC_VERSION}' — mettez à jour la grille ou rescorez`,
        );
      }
      const seenBrandIds = new Set();
      const seenBrandSlugs = new Set();
      for (const [i, brand] of brandsDoc.brands.entries()) {
        const where = `brands.fr-FR.json: brands[${i}] (${brand.slug || brand.id || '?'})`;
        if (brand.rubricVersion !== brandsDoc.rubricVersion) {
          errors.push(`${where}: rubricVersion '${brand.rubricVersion}' ≠ rubricVersion du fichier '${brandsDoc.rubricVersion}'`);
        }
        if (brand.score < MIN_PUBLISH_SCORE) {
          errors.push(`${where}: score ${brand.score} < ${MIN_PUBLISH_SCORE} (minimum de publication) — l'entrée ne peut pas être publiée`);
        }
        for (const c of brand.categories) {
          if (!BRAND_CATEGORIES.includes(c)) errors.push(`${where}: catégorie '${c}' hors liste blanche`);
        }
        for (const l of brand.labels) {
          if (!labelIds.has(l)) errors.push(`${where}: label '${l}' inconnu du catalogue schemas/labels.catalog.json`);
        }
        if (!isHttpsUrl(brand.url)) errors.push(`${where}: url '${brand.url}' doit être HTTPS`);
        if (seenBrandIds.has(brand.id)) errors.push(`${where}: id en doublon`);
        if (seenBrandSlugs.has(brand.slug)) errors.push(`${where}: slug en doublon`);
        seenBrandIds.add(brand.id);
        seenBrandSlugs.add(brand.slug);
        if (!isValidDate(brand.reviewedAt)) errors.push(`${where}: reviewedAt doit être AAAA-MM-JJ`);
      }
    }
  }

  return { errors, warnings };
}

// ---------- main ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings } = validateAll(REPO_ROOT);
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length > 0) {
    console.error(`\n❌ Validation échouée (${errors.length} erreur(s)) :`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('✅ Validation du contenu OK');
}

#!/usr/bin/env node
/**
 * staleness.mjs — rapport de péremption (> 12 mois) :
 *  - articles dont la dernière validation (validatedAt) date de plus de 12 mois ;
 *  - marques dont la revue (reviewedAt) date de plus de 12 mois.
 * Non bloquant : écrit un tableau Markdown dans $GITHUB_STEP_SUMMARY (CI) ou stdout.
 */
import { readdirSync, statSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT as ROOT, CONTENT_DIR, STALENESS_MONTHS, LOCALE } from './lib/repo.mjs';
import { parseArticleFile } from './lib/frontmatter.mjs';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function monthsSince(dateISO, now = new Date()) {
  const d = new Date(dateISO + 'T00:00:00Z');
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

const now = new Date();
const staleArticles = [];
for (const file of walk(path.join(CONTENT_DIR, 'health')).filter((f) => f.endsWith('.md'))) {
  const { data } = parseArticleFile(file);
  if (data.status !== 'published' || !data.validatedAt) continue;
  const months = monthsSince(data.validatedAt, now);
  if (months > STALENESS_MONTHS) {
    staleArticles.push({ slug: data.slug, validatedAt: data.validatedAt, months: Math.floor(months), validatedBy: data.validatedBy });
  }
}

const brandsDoc = JSON.parse(readFileSync(path.join(CONTENT_DIR, 'brands', `brands.${LOCALE}.json`), 'utf8'));
const staleBrands = brandsDoc.brands
  .filter((b) => monthsSince(b.reviewedAt, now) > STALENESS_MONTHS)
  .map((b) => ({ slug: b.slug, reviewedAt: b.reviewedAt, months: Math.floor(monthsSince(b.reviewedAt, now)) }));

const lines = [];
lines.push(`## 📋 Rapport de péremption du contenu (${now.toISOString().slice(0, 10)})`);
lines.push('');
lines.push(`Seuil : revalidation nécessaire après **${STALENESS_MONTHS} mois** (spécifications éditoriales). Non bloquant.`);
lines.push('');
lines.push(`### Articles à revalider (${staleArticles.length})`);
lines.push('');
if (staleArticles.length === 0) lines.push('_Aucun article en péremption. ✅_');
else {
  lines.push('| Article | Validé le | Âge (mois) | Validé par |');
  lines.push('|---|---|---|---|');
  for (const a of staleArticles) lines.push(`| \`${a.slug}\` | ${a.validatedAt} | ${a.months} | ${a.validatedBy} |`);
}
lines.push('');
lines.push(`### Marques à revérifier (${staleBrands.length})`);
lines.push('');
if (staleBrands.length === 0) lines.push('_Aucune marque en péremption. ✅_');
else {
  lines.push('| Marque | Revue le | Âge (mois) |');
  lines.push('|---|---|---|');
  for (const b of staleBrands) lines.push(`| \`${b.slug}\` | ${b.reviewedAt} | ${b.months} |`);
}
lines.push('');

const report = lines.join('\n');
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile && existsSync(summaryFile)) appendFileSync(summaryFile, report + '\n');
else console.log(report);

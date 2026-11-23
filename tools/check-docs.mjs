#!/usr/bin/env node
/**
 * check-docs.mjs — contrôles docs-as-code (doc-maintenance.md §5) :
 *  1. chaque docs/**​/*.md possède un en-tête `Version:` et `Date:` (ou `last-reviewed:`) ;
 *  2. les liens internes relatifs entre docs résolvent vers des fichiers existants ;
 *  3. alerte (non bloquante) si la date est vieille de plus de 90 jours.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS_DIR = path.join(ROOT, 'docs');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const errors = [];
const warnings = [];
const now = Date.now();
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

for (const file of walk(DOCS_DIR)) {
  const rel = path.relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');
  const head = raw.slice(0, 2000);

  if (!/^Version:\s*\S+/m.test(head)) errors.push(`${rel}: en-tête 'Version:' manquant`);
  const dateMatch = head.match(/^(?:Date|last-reviewed):\s*(\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}, \d{4})/m);
  if (!dateMatch) errors.push(`${rel}: en-tête 'Date:' manquant (AAAA-MM-JJ ou « November 21, 2026 »)`);
  else if (now - Date.parse(dateMatch[1]) > NINETY_DAYS) {
    warnings.push(`${rel}: date ${dateMatch[1]} > 90 jours — à relire`);
  }

  // liens internes relatifs (hors blocs de code ```)
  const withoutCode = raw.replace(/```[\s\S]*?```/g, '');
  const linkRe = /\[[^\]]*\]\(([^)#\s]+\.md)(#[^)]*)?\)/g;
  let m;
  while ((m = linkRe.exec(withoutCode)) !== null) {
    const target = path.resolve(path.dirname(file), decodeURIComponent(m[1]));
    if (!existsSync(target)) errors.push(`${rel}: lien interne cassé → ${m[1]}`);
  }
}

for (const w of warnings) console.warn(`⚠️  ${w}`);
if (errors.length > 0) {
  console.error(`\n❌ check-docs échoué (${errors.length} erreur(s)) :`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('✅ check-docs OK');

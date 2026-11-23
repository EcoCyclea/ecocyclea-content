import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { WORDS_PER_MINUTE } from './repo.mjs';

/**
 * Parse un fichier Markdown avec frontmatter YAML délimité par `---`.
 * Retourne { data, body }.
 */
export function parseArticleFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  if (!raw.startsWith('---')) {
    throw new Error(`${filePath}: le fichier doit commencer par un délimiteur YAML '---'`);
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error(`${filePath}: frontmatter non terminé (délimiteur '---' manquant)`);
  }
  const yamlText = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  let data;
  try {
    data = YAML.parse(yamlText);
  } catch (err) {
    throw new Error(`${filePath}: YAML invalide: ${err.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${filePath}: le frontmatter doit être un objet YAML`);
  }
  return { data, body };
}

/** Temps de lecture calculé automatiquement : 200 mots/min, minimum 1 minute. */
export function computeReadingMinutes(body) {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateAll } from '../validate.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

function makeFixture({ articleYaml, articleBody = 'Corps de test.', brandsJson }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'eco-fixture-'));
  symlinkSync(path.join(ROOT, 'schemas'), path.join(dir, 'schemas'), 'dir');
  mkdirSync(path.join(dir, 'content', 'health', 'mon-cycle'), { recursive: true });
  mkdirSync(path.join(dir, 'content', 'brands'), { recursive: true });
  writeFileSync(path.join(dir, 'content', 'health', 'mon-cycle', 'test-article.md'), `---\n${articleYaml}\n---\n\n${articleBody}\n`);
  writeFileSync(
    path.join(dir, 'content', 'brands', 'brands.fr-FR.json'),
    JSON.stringify(brandsJson ?? validBrands()),
  );
  return dir;
}

const validArticle = `
id: art-test1
slug: test-article
category: mon-cycle
title: "Article de test suffisamment long"
summary: "Résumé de test suffisamment long pour passer la validation du schéma de quarante caractères."
spotlight: false
links:
  - label: "Source officielle"
    url: "https://www.ameli.fr/exemple"
    source: "Assurance Maladie"
    description: "Une source officielle utile pour l'article de test."
validatedBy: "Dr Test"
validatedByTitle: "Gynécologue"
validatedAt: "2026-11-01"
publishedAt: "2026-11-21"
status: published
`;

function validBrands() {
  return {
    rubricVersion: '1.0',
    brands: [
      {
        id: 'brand-test1',
        name: 'Marque Test',
        slug: 'marque-test',
        tagline: 'Tagline de la marque de test',
        description: 'Description de la marque de test, longue de plus de quarante caractères pour le schéma.',
        categories: ['culottes-menstruelles'],
        labels: ['made-in-france'],
        sustainabilityHighlights: ['Coton bio', 'Fabriqué en France', 'Emballage recyclable'],
        score: 70,
        rubricVersion: '1.0',
        url: 'https://example.com',
        priceRange: '€€',
        reviewedBy: 'Équipe Ecocyclea',
        reviewedAt: '2026-11-01',
        regions: ['fr-FR'],
      },
    ],
  };
}

test('le dépôt réel est valide', () => {
  const { errors } = validateAll(ROOT);
  assert.deepEqual(errors, []);
});

test('article publié sans validatedBy → erreur', () => {
  const dir = makeFixture({ articleYaml: validArticle.replace('validatedBy: "Dr Test"\n', '') });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('validatedBy')));
  rmSync(dir, { recursive: true, force: true });
});

test('lien non-HTTPS → erreur', () => {
  const dir = makeFixture({ articleYaml: validArticle.replace('https://www.ameli.fr/exemple', 'http://www.ameli.fr/exemple') });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('HTTPS')));
  rmSync(dir, { recursive: true, force: true });
});

test('readingMinutes incohérent avec le calcul auto → erreur', () => {
  const dir = makeFixture({ articleYaml: validArticle.replace('status: published', 'readingMinutes: 30\nstatus: published') });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('readingMinutes')));
  rmSync(dir, { recursive: true, force: true });
});

test('score < 60 → erreur de publication', () => {
  const brands = validBrands();
  brands.brands[0].score = 40;
  const dir = makeFixture({ articleYaml: validArticle, brandsJson: brands });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('60')));
  rmSync(dir, { recursive: true, force: true });
});

test('rubricVersion incohérente → erreur', () => {
  const brands = validBrands();
  brands.brands[0].rubricVersion = '0.9';
  const dir = makeFixture({ articleYaml: validArticle, brandsJson: brands });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('rubricVersion')));
  rmSync(dir, { recursive: true, force: true });
});

test('label inconnu du catalogue → erreur', () => {
  const brands = validBrands();
  brands.brands[0].labels = ['label-invente'];
  const dir = makeFixture({ articleYaml: validArticle, brandsJson: brands });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('label-invente')));
  rmSync(dir, { recursive: true, force: true });
});

test('slug ≠ nom de fichier → erreur', () => {
  const dir = makeFixture({ articleYaml: validArticle.replace('slug: test-article', 'slug: autre-slug') });
  const { errors } = validateAll(dir);
  assert.ok(errors.some((e) => e.includes('slug')));
  rmSync(dir, { recursive: true, force: true });
});

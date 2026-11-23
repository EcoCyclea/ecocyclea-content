# ecocyclea-content — source de vérité du contenu Ecocyclea

Version: 1.0
Date: November 22, 2026

Dépôt privé contenant **tout le contenu éditorial** d'Ecocyclea (articles « Prévention &
Santé », annuaire « Marques engagées »), les **schémas** de validation, la **CI** qui construit
et signe le flux, et le **worker de soumissions** de marques.

> La documentation produit (specs, ADRs, plan) est canonique ici, dans `docs/`
> (ADR-0002). Dans le dépôt app `ecocyclea/`, `docs` est un lien symbolique vers ce dossier.

## Arborescence

```
ecocyclea-content/
├── docs/                     # specs produit + ADRs (canoniques)
│   └── rubric-brand-v1.0.md  # grille de revue publique des marques
├── content/
│   ├── health/<categorie>/<slug>.md    # articles (frontmatter YAML + Markdown)
│   └── brands/brands.fr-FR.json        # marques (source)
├── schemas/                  # JSON Schema : frontmatter, brands, manifest + catalogue de labels
├── templates/article.md      # modèle d'article (sign-off gynécologue)
├── tools/                    # validation, build+signature, staleness, tests (Node 22, zéro dep native)
├── submissions-worker/       # Cloudflare Worker : soumissions anonymes + page de revue (Phase 2)
└── .github/workflows/content.yml
```

## Flux de publication (résumé)

```
PR (article/marque) → CI validate (schémas + règles éditoriales + tests)
                    → CI build : dist/ + manifeste signé Ed25519 (+ versions/<timestamp>/)
push sur main       → signature avec FEED_SIGNING_PRIVATE_KEY → upload S3-compatible
                      latest/ (max-age=300) + versions/<version>/ (immutable) → purge CDN
```

L'app récupère `manifest.fr-FR.json` (ETag/If-None-Match), **vérifie la signature Ed25519 avec
la clé publique épinglée dans le bundle**, vérifie les sha256, puis remplace le cache local de
façon atomique. Rollback : repointer `latest/` vers une version archivée. Voir
[docs/adr/0004-feed-signing-and-versioning.md](docs/adr/0004-feed-signing-and-versioning.md).

## Ajouter un article

1. `cp templates/article.md content/health/<categorie>/<slug>.md` et remplir le frontmatter.
2. Ouvrir une PR. La CI valide le schéma, les liens (HTTPS), la catégorie, le `readingMinutes`
   (auto-calculé) et exige `validatedBy`/`validatedAt` pour `status: published`.
3. Le gynécologue partenaire signe (sign-off dans le frontmatter) → merge → publié en minutes,
   **sans release de l'app**.

## Ajouter / modifier une marque

- Édition équipe : PR sur `content/brands/brands.fr-FR.json` (score selon
  [docs/rubric-brand-v1.0.md](docs/rubric-brand-v1.0.md), min 60, `rubricVersion` cohérent).
- Soumission utilisateur : via l'app → worker (`submissions-worker/`) → file de revue → PR.

## Lancer les outils en local

```bash
cd tools
npm ci
npm run validate      # validation schémas + règles éditoriales
npm test              # tests unitaires (node --test)
DEV_EPHEMERAL_KEY=1 npm run build   # build signé avec clé éphémère (test)
npm run staleness     # rapport de péremption > 12 mois
npm run check-docs    # métadonnées + liens internes des docs
npm run keygen -- --out-dir ../.secrets   # paire Ed25519 de production (voir OPERATIONS.md)
```

## Secrets CI requis (GitHub Actions)

| Secret | Rôle |
| --- | --- |
| `FEED_SIGNING_PRIVATE_KEY` | clé privée Ed25519 (PKCS8 PEM) pour signer le manifeste sur `main` |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | upload vers le stockage S3-compatible (Cloudflare R2 ou OVH Object Storage) |
| `CDN_BASE_URL` | URL publique du CDN (ex. `https://cdn.ecocyclea.fr`) |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` | purge optionnelle du cache CDN après publication |

Voir [OPERATIONS.md](OPERATIONS.md) pour la rotation des clés et le rollback.

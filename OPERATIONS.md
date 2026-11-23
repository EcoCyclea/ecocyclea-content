# OPERATIONS — clés, publication, rollback

Version: 1.0
Date: November 22, 2026

## 1. Clés de signature du flux (Ed25519)

```bash
cd tools && npm run keygen -- --out-dir ../.secrets
# → .secrets/feed-signing-private.pem  : à copier dans le secret GitHub FEED_SIGNING_PRIVATE_KEY
# → .secrets/feed-signing-public.hex   : clé publique (32 octets, hex) à ÉPINGLER dans l'app
#                                         (src/core/config/feed.ts → FEED_PUBLIC_KEY_HEX)
```

**Rotation** : générer une nouvelle paire, mettre à jour le secret CI, épingler la nouvelle clé
publique dans une **release de l'app**, puis re-signer le flux (le prochain push main suffit).
Les anciennes versions signées restent lisibles tant que l'app les a en cache ; une app avec
l'ancienne clé épinglée refusera les nouveaux manifestes → prévoir la rotation côté app en
premier, ou accepter une fenêtre où l'app garde son cache (comportement de sécurité voulu).

Ne jamais committer `.secrets/` (voir `.gitignore`).

## 2. Publication manuelle (hors CI)

```bash
cd tools
FEED_SIGNING_PRIVATE_KEY="$(cat ../.secrets/feed-signing-private.pem)" CDN_BASE_URL=https://cdn.ecocyclea.fr node build-feed.mjs
# upload :
aws s3 cp dist/manifest.fr-FR.json s3://$S3_BUCKET/feeds/fr-FR/latest/ --endpoint-url $S3_ENDPOINT ...
# (mêmes commandes que .github/workflows/content.yml, job publish)
```

## 3. Rollback

Chaque build est archivé sous `feeds/fr-FR/versions/<version>/`. Pour revenir en arrière :
recopier les fichiers d'une ancienne version vers `latest/` (ou repointer le domaine CDN), puis
purger le cache CDN. L'app refuse toute version **antérieure** à son cache (version monotone) :
le rollback s'applique aux appareils qui n'ont pas encore téléchargé la mauvaise version.

## 4. Révocation d'urgence d'un article/marque

Passer `status: retracted` (article) ou retirer la marque du JSON, merger sur `main` : la CI
rebuild + republish en quelques minutes, **sans release app**. Les apps retirent l'élément au
prochain rafraîchissement du flux.

## 5. Staleness

Le job `staleness` de la CI liste dans le résumé du job les articles non revalidés depuis
> 12 mois et les marques non revues depuis > 12 mois (non bloquant). Balayage éditorial :
`npm run staleness` en local.

## 6. Tokens Cloudflare (quelles policies)

Deux tokens, deux rôles — jamais dans le repo, uniquement en secrets CI / `wrangler secret`.

### 6.1 API token « déploiement » (custom token, compte + zone `ecocyclea.fr` uniquement)

| Ressource | Permission | Pourquoi |
| --- | --- | --- |
| Account → Workers Scripts | Edit | `wrangler deploy`, `wrangler secret put REVIEW_SECRET` |
| Account → D1 | Edit | `wrangler d1 create ecocyclea-submissions`, migrations |
| Account → Workers KV Storage | Edit | `wrangler kv namespace create RATE_KV` |
| Zone `ecocyclea.fr` → Workers Routes | Edit | attacher `submissions.ecocyclea.fr` |
| Zone `ecocyclea.fr` → DNS | Edit | enregistrement du sous-domaine |
| Zone `ecocyclea.fr` → Cache Purge | Purge | `tools/purge-cdn.mjs` après publication du flux |

Astuce : le template intégré « Edit Cloudflare Workers » couvre Workers/KV/D1 ; ajoute les
3 permissions zone. Mettre une expiration (ex. 90 jours) et une restriction IP si possible.

### 6.2 Token R2 (upload du flux signé par la CI)

*API Tokens → Create R2 API Token* : permission « Object Read & Write » **limitée au bucket
`ecocyclea-feeds`**. Fournit `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` et l'endpoint
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (à mettre dans `S3_ENDPOINT`).

### 6.3 Secrets GitHub Actions à renseigner

| Workflow | Secrets |
| --- | --- |
| `deploy-worker.yml` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `content.yml` | `FEED_SIGNING_PRIVATE_KEY` (contenu du `.pem` de `tools/keygen.mjs`), `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CDN_BASE_URL`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` (purge CDN optionnelle) |

Gratuit à notre échelle : Workers Free = 100k req/jour, D1 = 5 Go + 100k écritures/jour,
KV = 1k écritures/jour, R2 = 10 Go — voir §6 pour le détail.

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

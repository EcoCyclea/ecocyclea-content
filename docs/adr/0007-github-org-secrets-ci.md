# ADR-0007 — Dépôt dans l'organisation GitHub EcoCyclea, secrets CI et déploiement automatique

Version: 1.0
Date: November 24, 2026
Status: Accepted

## Contexte

Le dépôt de contenu vivait en local sans remote. Il doit être versionné dans
l'organisation GitHub **EcoCyclea** (`github.com/EcoCyclea/ecocyclea-content`),
privé, avec une CI qui valide, signe (Ed25519) et publie le flux sur R2, et qui
déploie le worker de soumissions sur Cloudflare.

## Décisions

1. **Dépôt privé dans l'org** `EcoCyclea/ecocyclea-content`, branche par défaut `main`.
   Aucun secret dans le dépôt : la clé privée de signature du flux est dans
   `.secrets/` (gitignoré, chmod 600) et uniquement dans le secret GitHub
   `FEED_SIGNING_PRIVATE_KEY`. La clé publique (hex) est épinglée dans l'app et
   documentée dans `OPERATIONS.md`.

2. **Secrets GitHub Actions** (Settings → Secrets → Actions) :
   `FEED_SIGNING_PRIVATE_KEY`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, `CDN_BASE_URL`, `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID` (+ `CLOUDFLARE_ZONE_ID` optionnel pour la purge CDN).
   Les valeurs sensibles sont posées via `gh secret set … --body "$(pbpaste)"`
   (presse-papiers) pour ne jamais transiter par un chat ni un fichier en clair.

3. **Pas de protection de branche** : sur le plan GitHub Free, les règles de
   protection (PR obligatoire, checks requis) sont réservées aux dépôts publics
   ou aux plans payants (Pro/Team). Le dépôt reste privé → pas de protection
   appliquée. En compensation, les deux workflows ont un déclencheur
   `pull_request` **sans filtre de chemins**, donc les 4 checks
   (validate / staleness / build-signé-en-PR-avec-clé-éphémère / test worker)
   s'exécutent sur **chaque** PR.

4. **Déploiement continu** : push sur `main` touchant `content|schemas|tools|templates|docs`
   → `content.yml` (validate → staleness → build+sign → verify → publish R2 ;
   `latest/` en cache court + `versions/<ts>/` immuable pour le rollback).
   Push touchant `submissions-worker/**` → `deploy-worker.yml`
   (tests Miniflare → migrations D1 → `wrangler deploy`).

5. **Révocation immédiate de tout identifiant exposé** : des tokens Cloudflare
   ont été collés dans une conversation le 2026-11-24 → révoqués et régénérés le
   même jour. Règle : jamais de secret dans un chat ; révocation dès l'exposition.

## Conséquences

- Le flux publié est signé avec la clé dont la publique est
  `1d1c4d0c87911a8ab2a8cb8562d87b183ad170b275d7fe283034de887b9407c6`
  (voir OPERATIONS.md) ; l'app épingle cette clé.
- En cas de fuite de `FEED_SIGNING_PRIVATE_KEY` : rotation selon OPERATIONS.md §1
  (nouvelle paire → secret CI → nouvelle release app avec nouvelle clé épinglée →
  re-signe au prochain push main).

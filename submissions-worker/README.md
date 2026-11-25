# submissions-worker — soumissions anonymes « Marques engagées »

Version: 1.0
Date: November 22, 2026

Worker Cloudflare (TypeScript) : file de soumissions en **D1**, rate-limit en **KV**,
page de revue interne, page publique de transparence. Aucun compte, aucun email :
seul le **hash SHA-256 du jeton d'appareil** est stocké (anti-spam), jamais le jeton.

## API

| Route | Méthode | Rôle |
| --- | --- | --- |
| `/submissions` | POST | `{name, url, category, reason, antiSpamToken}` → `201 {code, status:'pending'\|'accepted'}` (code 8 car. aléatoire ; `accepted` + PR auto créée si `GITHUB_TOKEN` posé) |
| `/webhooks/github` | POST | Webhook GitHub « Pull request » (signature HMAC vérifiée) : branche `review/marque-<code>` → synchro du statut (opened→`accepted`, merged→`published`, closed→`rejected`) |
| `/submissions/:code` | GET | → `{code, status: pending\|accepted\|published\|rejected}` (404 si inconnu) |
| `/reports` | POST | `{type: brand-report\|brand-update, brandSlug?, message, antiSpamToken}` → file de revue |
| `/` | GET | Page publique : marques publiées récemment + lien vers la grille |
| `/review?secret=…` | GET | Page de revue interne (file + preuves + actions) |
| `/review/api/queue?secret=…` | GET | File en JSON pour la page de revue |
| `/review/accept/:id?secret=…` | POST | Passe en `accepted` + renvoie `prUrl`. Si le secret `GITHUB_TOKEN` (PAT fine-grained, contents read/write sur le dépôt) est posé, la PR est **créée directement** (branche `review/marque-<code>` + commit de l'entrée dans `content/brands/brands.fr-FR.json`) ; sinon URL de PR préremplie à créer manuellement. |
| `/review/reject/:id?secret=…` | POST | `{reason}` → `rejected` (nulle part affiché publiquement) |
| `/review/publish/:id?secret=…` | POST | Passe en `published` (visible page publique ; la marque ira dans le flux à la prochaine revue d'équipe) |

Rate limit : `RATE_LIMIT_PER_HOUR` (défaut 5) soumissions/heure par hash de jeton.

## Flux de revue complet (bout en bout) — revue au niveau de la PR GitHub

La revue se fait **dans la PR**, pas dans une file interne : toute soumission ouvre
automatiquement une PR sur le dépôt de contenu, un humain la complète + approuve, et
seul le merge publie. Le statut de la soumission suit le cycle de vie de la PR
(webhook GitHub).

1. **Soumission (app)** — `POST /submissions` depuis l'app (écran « Suggérer une marque »)
   → `201 {code, status}`. Le code (8 caractères) est stocké en D1 ; l'app ouvre
   l'écran `marques/statut/:code` qui lit `GET /submissions/:code` (pull-to-refresh).
   Aucun compte, aucun email.
   - Si **`GITHUB_TOKEN`** est posé (GitHub) : la **PR est créée immédiatement**
     (branche `review/marque-<code>` depuis `main`, commit de l'entrée squelette dans
     `content/brands/brands.fr-FR.json`, PR ouverte) et le statut passe à `accepted`
     → `201 {code, status:'accepted'}`.
   - Sinon : statut `pending` ; l'admin déclenche la PR via « Accepter → PR » sur
     `/review` (`POST /review/accept/:id`), qui crée la PR si `GITHUB_TOKEN` est posé,
     sinon renvoie une URL `…/compare/main...review/marque-<code>?expand=1…` à ouvrir
     manuellement. Idempotent : la PR existante est renvoyée, pas de doublon.
2. **Revue = PR GitHub** — le relecteur complète l'entrée squelette (`score: 0` →
   la CI bloque tant que ce n'est pas fait) : `tagline`, `description`, `labels`,
   `sustainabilityHighlights`, **`score` ≥ 60** et `rubricVersion: "1.0"` selon
   `docs/rubric-brand-v1.0.md`, avec **preuves vérifiables** citées dans la PR.
   Checklist de revue : `.github/PULL_REQUEST_TEMPLATE.md` (inclut les rejets critiques :
   affirmations non vérifiables, greenwashing, drapeau santé).
3. **Merge sur `main`** — possible uniquement via PR approuvée + CI verte
   (voir « Garde-fous GitHub » ci-dessous) : la CI `content.yml` valide schéma +
   score ≥ 60 + rubricVersion, signe et publie le flux (R2/CDN). La marque apparaît
   dans l'annuaire de l'app au prochain rafraîchissement (**pas de release app**).
4. **Synchronisation des statuts** — webhook GitHub « Pull request » →
   `POST /webhooks/github` (signature `X-Hub-Signature-256` vérifiée avec
   `GITHUB_WEBHOOK_SECRET`) :
   - PR `opened`/`reopened` sur `review/marque-<code>` → `accepted`
   - PR `closed` + merged → `published` (visible page publique `/` et dans l'app
     `marques/statut/:code`)
   - PR `closed` sans merge → `rejected` (jamais affiché publiquement ; la PR et son
     commentaire de fermeture servent de motif interne, `review_notes` trace l'URL)

La page `/review?secret=<REVIEW_SECRET>` reste utile comme vue d'ensemble de la file
D1 (codes, statuts, liens de PR en `review_notes`) et comme secours manuel
(accept/reject/publish) si le webhook n'est pas configuré.

### Garde-fous GitHub (obligatoires pour que la revue PR ait un sens)

Sur `EcoCyclea/ecocyclea-content` → Settings → Branches → Branch protection pour `main` :

- [ ] **Require a pull request before merging** + **Require approvals: 1**
- [ ] **Require status checks to pass** (jobs de `.github/workflows/content.yml`)
- [ ] **Block force pushes** et **no direct pushes** (restrict pushes to admins only)
- [ ] Le PAT `GITHUB_TOKEN` doit rester **Contents: read/write uniquement** (pas
      d'admin/merge) : il crée des branches/PR, il ne merge pas — le merge n'est
      possible que via une PR approuvée par un humain.

### Configuration du webhook GitHub

Repo → Settings → Webhooks → Add webhook :

- Payload URL : `https://ecocyclea-submissions.ecocyclea.workers.dev/webhooks/github`
- Content type : `application/json`
- Secret : la valeur de `GITHUB_WEBHOOK_SECRET`
- Events : **Pull request** uniquement

### Secrets du worker (jamais en clair, jamais dans un chat — ADR-0007)

| Secret | Rôle | Pose |
| --- | --- | --- |
| `REVIEW_SECRET` | Protège `/review*` (query `?secret=` ou header `X-Review-Secret`) | `echo "<valeur>" \| wrangler secret put REVIEW_SECRET` |
| `GITHUB_TOKEN` | PAT fine-grained (Contents: read/write sur le dépôt de contenu) : crée la PR automatiquement à la soumission / à l'acceptation | `echo "<pat>" \| wrangler secret put GITHUB_TOKEN` |
| `GITHUB_WEBHOOK_SECRET` | Signe le webhook GitHub (`/webhooks/github`) pour la synchro des statuts | `echo "<valeur>" \| wrangler secret put GITHUB_WEBHOOK_SECRET` |

Règle : révocation + rotation dès qu'un secret est exposé (chat, URL, logs) — les secrets
apparaissent dans les URLs `?secret=…`, donc ne jamais partager ces URLs complètes.
Conserver les valeurs dans un gestionnaire de mots de passe.

## Déploiement

```bash
npm ci
wrangler login                                  # une fois (ou CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
wrangler d1 create ecocyclea-submissions        # → copier l'uuid dans wrangler.toml (déjà fait : f5a7529f-…)
wrangler kv namespace create RATE_KV            # → copier l'id dans wrangler.toml (déjà fait : 1073caba…)
echo "<secret>" | wrangler secret put REVIEW_SECRET   # secret de la page de revue (à conserver dans un gestionnaire de mots de passe)
npx wrangler d1 migrations apply ecocyclea-submissions --remote
npx wrangler deploy
# → déployé sur https://ecocyclea-submissions.ecocyclea.workers.dev
# Pour submissions.ecocyclea.fr : CNAME chez le registrar DNS pointant vers
# ecocyclea-submissions.ecocyclea.workers.dev (le domaine n'étant pas une zone Cloudflare).
```

CI : `.github/workflows/deploy-worker.yml` (test Miniflare puis déploiement sur push main,
secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).

## Tests locaux

```bash
npm test        # node --test avec Miniflare (D1 + KV locaux)
wrangler dev    # test manuel
```

## Déploiement en CI (2026-11-24)

Le déploiement est automatisé : push sur `main` touchant `submissions-worker/**` →
`.github/workflows/deploy-worker.yml` (tests Miniflare, migrations D1, `wrangler deploy`)
avec les secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.
URL workers.dev : `https://ecocyclea-submissions.ecocyclea.workers.dev`.
Custom domain `submissions.ecocyclea.fr` à brancher ensuite (voir OPERATIONS.md).

<!-- 2026-11-24: relance du déploiement CI après correction des permissions du token (D1/KV/Workers Scripts Edit) -->

<!-- 2026-11-24 16:08: CLOUDFLARE_ACCOUNT_ID corrigé (df100…) -->

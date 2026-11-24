# submissions-worker — soumissions anonymes « Marques engagées »

Version: 1.0
Date: November 22, 2026

Worker Cloudflare (TypeScript) : file de soumissions en **D1**, rate-limit en **KV**,
page de revue interne, page publique de transparence. Aucun compte, aucun email :
seul le **hash SHA-256 du jeton d'appareil** est stocké (anti-spam), jamais le jeton.

## API

| Route | Méthode | Rôle |
| --- | --- | --- |
| `/submissions` | POST | `{name, url, category, reason, antiSpamToken}` → `201 {code, status:'pending'}` (code 8 car. aléatoire) |
| `/submissions/:code` | GET | → `{code, status: pending\|accepted\|published\|rejected}` (404 si inconnu) |
| `/reports` | POST | `{type: brand-report\|brand-update, brandSlug?, message, antiSpamToken}` → file de revue |
| `/` | GET | Page publique : marques publiées récemment + lien vers la grille |
| `/review?secret=…` | GET | Page de revue interne (file + preuves + actions) |
| `/review/api/queue?secret=…` | GET | File en JSON pour la page de revue |
| `/review/accept/:id?secret=…` | POST | Passe en `accepted` + renvoie `prUrl` (PR GitHub préremplie ajoutant la marque à `content/brands/brands.fr-FR.json`) |
| `/review/reject/:id?secret=…` | POST | `{reason}` → `rejected` (nulle part affiché publiquement) |
| `/review/publish/:id?secret=…` | POST | Passe en `published` (visible page publique ; la marque ira dans le flux à la prochaine revue d'équipe) |

Rate limit : `RATE_LIMIT_PER_HOUR` (défaut 5) soumissions/heure par hash de jeton.

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

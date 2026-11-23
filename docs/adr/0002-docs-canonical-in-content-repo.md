# ADR-0002 — Les docs deviennent canoniques dans le dépôt `ecocyclea-content`

Version: 1.0
Date: November 22, 2026
Status: Accepted

## Contexte

`doc-maintenance.md` §2 prévoit que le dossier local `~/Documents/projects/ecocyclea/docs/`
devienne, dès la Phase 0, un checkout du dossier `docs/` du dépôt `ecocyclea-content`.

## Décision

- Le dépôt `ecocyclea-content` (créé en Phase 0) contient désormais le dossier `docs/` canonique,
  y compris les ADRs (`docs/adr/`).
- Dans le dépôt app `ecocyclea/`, `docs` est un **lien symbolique** vers
  `../ecocyclea-content/docs`, pour que les références existantes continuent de résoudre.
- Toute modification de spec se fait dans `ecocyclea-content` (PR reviewée), conformément au
  protocole docs-as-code.

## Conséquences

- Une seule source de vérité pour la documentation ; la CI du dépôt content contrôle les
  métadonnées et les liens internes des docs (`tools/check-docs.mjs`).

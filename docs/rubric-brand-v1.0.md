# Grille de revue des marques — « Marques engagées » (rubric v1.0)

Version: 1.0
Date: November 22, 2026
Status: Publiée — référence pour la revue de l'équipe Ecocyclea

> Cette grille est la référence publique exigée par la spec « Marques engagées » §4
> (lien « Pourquoi cette marque ? » dans l'app). Toute modification de la grille est
> versionnée (v1.1, v2.0…) et mentionnée dans l'app.

## Critères et pondérations

| Critère | Poids | Preuves attendues |
| --- | --- | --- |
| Matériaux | 30 % | Coton bio (GOTS), matières naturelles ou recyclées, liste de matériaux transparente |
| Empreinte française | 25 % | Fabrication en France, ateliers en France, entreprise française |
| Durabilité / réutilisable | 20 % | Produits réutilisables, garanties de durabilité, réparabilité |
| Certifications & labels | 15 % | OEKO-TEX, GOTS, Ecocert, B Corp, labels reconnus par l'ADEME |
| Emballage & fin de vie | 10 % | Emballage minimal/recyclable, programmes de reprise |

## Règles de publication

- **Score minimum pour publier : 60/100.**
- **Rejet critique** (quel que soit le score) : affirmations non vérifiables, greenwashing
  sans preuve, ou drapeau rouge santé/sécurité.
- Chaque entrée publiée porte `score`, `rubricVersion`, `reviewedBy` et `reviewedAt` dans le
  flux ; la CI du dépôt bloque toute incohérence (score < 60 ou rubricVersion ≠ grille courante).
- Les preuves (liens vers les pages de la marque, registres des labels) sont conservées dans
  la file de revue interne.
- Revue à cadence hebdomadaire par l'équipe ; les entrées de plus de 12 mois affichent un
  avertissement « vérifier l'actualité des informations » dans l'app.

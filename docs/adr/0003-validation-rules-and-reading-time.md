# ADR-0003 — Règles de validation éditoriale et temps de lecture automatique

Version: 1.0
Date: November 22, 2026
Status: Accepted

## Contexte

La spec santé exige qu'un article `published` ait des métadonnées de validation et « au moins
une source par article à forte densité d'affirmations » (« claim-heavy »), notion floue.
Elle mentionne aussi un `readingMinutes` « auto-computed ».

## Décision

- **Temps de lecture** : calculé automatiquement par la CI à la construction du flux
  (`ceil(mots / 200)`, minimum 1 min). Si le frontmatter renseigne `readingMinutes`, la CI
  échoue si la valeur diffère du calcul — le champ sert de contrôle qualité humain, la valeur
  publiée est toujours la valeur calculée.
- **Liens de source** : la règle « au moins un lien vérifié » est appliquée à **tous** les
  articles publiés (et non « claim-heavy » seulement). Justification : dans une section santé,
  tout article publié contient des affirmations factuelles ; exiger une source partout est
  plus sûr juridiquement et ne coûte rien éditorialement (les sources sont de toute façon
  requises par la spec pour les articles concernés).
- **Liens** : HTTPS obligatoire, sans identifiants dans l'URL, domaine résolvable (syntaxe).
- **Marques** : score minimum de publication 60/100 (spec §4) contrôlé en CI, et cohérence
  stricte `rubricVersion` entre le fichier, chaque entrée, et la version de grille courante.

## Conséquences

- `tools/validate.mjs` échoue sur : article publié sans sign-off, sans lien, lien non-HTTPS,
  catégorie hors liste blanche, label hors catalogue, score < 60, rubricVersion incohérente,
  `readingMinutes` faux, id/slug en doublon, slug ≠ nom de fichier.

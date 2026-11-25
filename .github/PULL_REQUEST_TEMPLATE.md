# Revue « Marques engagées » — grille v1.0

Cette PR a été créée automatiquement depuis une soumission dans l'app (code de suivi
en description). Avant de merger, vérifier :

- [ ] Entrée complétée dans `content/brands/brands.fr-FR.json` : `tagline` (5–120 car.),
      `description` (40–300 car.), `labels` (ids du catalogue `schemas/labels.catalog.json`),
      `sustainabilityHighlights` (3–5 puces)
- [ ] `score` **≥ 60** calculé selon `docs/rubric-brand-v1.0.md`, avec les **preuves
      vérifiables** citées dans la description de la PR (liens vers les pages de la marque,
      registres des labels GOTS/OEKO-TEX/Ecocert…)
- [ ] `rubricVersion: "1.0"` et schéma valide (la CI bloque sinon)
- [ ] **Pas de rejet critique** (quel que soit le score) : affirmations non vérifiables,
      greenwashing sans preuve, ou drapeau rouge santé/sécurité (revue médicale requise
      si la fiche touche à une allégation de santé)
- [ ] `url` en HTTPS, `categories` dans la liste blanche, `regions: ["fr-FR"]`

La CI valide schéma + score + rubricVersion, signe et publie le flux à la fusion :
aucune release app n'est nécessaire, la marque apparaîtra dans l'annuaire au prochain
rafraîchissement. Le merge de cette PR passe la soumission en `published` (webhook);
sa fermeture sans merge la passe en `rejected`.

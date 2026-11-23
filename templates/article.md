---
# Champs obligatoires : id, slug, category, title, summary, spotlight, links, publishedAt, status
# status: draft | published | retracted
# Un article « published » DOIT avoir validatedBy, validatedByTitle, validatedAt
# et au moins un lien (source vérifiée) — contrôlé par la CI.
# readingMinutes est optionnel : s'il est renseigné, il doit correspondre au
# calcul automatique (200 mots/min) ; le flux publié utilise la valeur calculée.
# Toute modification du contenu après validation remet l'article en « draft »
# jusqu'à nouvelle sign-off du gynécologue partenaire.
id: art-XXXX
slug: mon-slug-ici            # doit correspondre au nom du fichier
category: mon-cycle           # mon-cycle | contraception | depistage-prevention | ist | fertilite-grossesse | menopause
title: "Titre de l'article"
summary: "Résumé en 1–2 phrases affiché dans la liste des articles (40–300 caractères)."
readingMinutes: 4             # optionnel, vérifié automatiquement
tags: [tag1, tag2]
spotlight: false              # true = « À la une » (1–3 articles)
links:
  - label: "Nom de la ressource"
    url: "https://..."        # HTTPS obligatoire
    source: "Organisme (ex. Assurance Maladie)"
    description: "Pourquoi cette source est fiable et ce qu'elle apporte."
validatedBy: "Dr Prénom Nom"  # requis si status: published
validatedByTitle: "Gynécologue-obstétricienne"
validatedAt: "2026-11-21"     # requis si status: published (AAAA-MM-JJ)
publishedAt: "2026-11-21"
status: draft
---

## Un titre de section

Corps de l'article en Markdown : paragraphes, listes,gras, etc.

> **À retenir** : les encadrés (callouts) utilisent les blockquotes avec un label en gras.

### FAQ

**Question ?**
Réponse.

# ADR-0006 — Décisions v1 des fonctionnalités de contenu (UI, navigateur, worker, catalogue de labels)

Version: 1.0
Date: November 22, 2026
Status: Accepted

## Contexte

Plusieurs choix d'implémentation restaient ouverts après ADR-0001 (plateforme RN).

## Décisions

1. **Plus de marques en dur dans l'app.** Le bloc `ECO_BRANDS_FR` de l'onglet « Impact éco »
   est supprimé : tout le contenu éditorial de marques provient désormais du flux signé
   (contrainte « content never hardcoded »). Seul le **catalogue carbone des produits**
   reste embarqué — c'est un choix de design initial documenté (README), pas du contenu éditorial.
2. **Navigateur in-app** : `react-native-inappbrowser-reborn`, qui utilise
   **ASWebAuthenticationSession** sur iOS (équivalent SFSafariViewController : domaine visible,
   session dans l'app) et Custom Tabs sur Android. L'URL reste copiable via un bouton dédié
   (`@react-native-clipboard/clipboard`).
3. **Rendu Markdown** : `react-native-markdown-display` — rendu natif in-app, fonctionne
   hors ligne depuis le cache. Les liens du corps s'ouvrent dans le navigateur in-app.
4. **Backend de soumissions** : **Cloudflare Worker + D1 + KV** (la spec autorisait
   « Cloudflare Worker ou OVH API »). D1 = file de revue ; KV = rate-limit par hash de jeton.
   Page de revue interne servie par le worker (secret `REVIEW_SECRET`), page publique `/`
   (marques publiées + lien grille).
5. **Déviation par rapport au plan §3.2** : la « requête signée HMAC (app-token rotatif) »
   prévue par le plan n'est PAS implémentée en v1. La spec (contrat) demande un jeton
   d'appareil anonyme réinitialisable + rate-limit — ce qui est implémenté. Un HMAC embarqué
   n'apporterait aucune protection anti-spam supplémentaire (le « secret » serait dans l'app)
   et compliquerait le reset du jeton. À réévaluer si le spam devient un problème.
6. **Catalogue de labels** : dupliqué dans l'app (`src/data/content/labelCatalog.ts`) pour
   l'affichage (noms + infobulles), conformément au plan §3.2 ; la CI du dépôt content
   valide que les labels du flux appartiennent au catalogue canonique
   (`schemas/labels.catalog.json`).

## Conséquences

- `grep` ne trouve plus aucun contenu éditorial en dur dans `src/` de l'app.
- Seuls l'URL du flux et la clé publique Ed25519 sont épinglés dans le bundle.

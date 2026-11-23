# ADR-0001 — Implémentation des fonctionnalités de contenu dans l'app React Native (et non SwiftUI)

Version: 1.0
Date: November 22, 2026
Status: Accepted

## Contexte

Les specs (`feature-spec-prevention-and-health.md`, `feature-spec-eco-brand-directory.md`,
`implementation-plan-content-features.md` v1.0) décrivent l'app iOS avec des termes natifs :
« SwiftUI », « Core Data », « SFSafariViewController ».

Le code existant du produit (`ecocyclea/`) est une application **React Native 0.88 + TypeScript**
(React Navigation, Zustand, stockage chiffré MMKV AES-256), avec un dossier `ios/` qui n'est
que le shell natif de React Native — il n'existe pas de projet SwiftUI séparé.

## Décision

Implémenter les deux fonctionnalités de contenu dans **l'application React Native existante**,
avec les équivalences suivantes (les exigences comportementales des specs sont conservées) :

| Spec (v1.0, natif) | Implémentation réelle (React Native) | Justification |
| --- | --- | --- |
| SwiftUI | Composants React Native + design system existant (`src/core/theme`) | Une seule app livrée ; pas de second codebase |
| `ContentFeedClient` Swift | `ContentFeedClient` TypeScript (`src/data/content/`) | Même contrat : fetch ETag, vérification Ed25519, cache atomique |
| Core Data (état de lecture) | MMKV chiffré existant (`src/core/storage/secureStorage.ts`) | Déjà chiffré AES-256, 100 % local — même garantie « rien ne quitte l'appareil » |
| SFSafariViewController | `ASWebAuthenticationSession` via `react-native-inappbrowser-reborn` | Même comportement : navigateur in-app, domaine visible, URL copiable depuis notre UI |
| « rendu Markdown natif » | `react-native-markdown-display` | Rendu in-app du Markdown du flux, hors ligne |
| Cache fichiers + swap atomique | MMKV (set atomique par clé) + cache disque images | MMKV est chiffré at rest, ce qui est mieux que le cache Core Data/fichiers pour des données de contenu |

## Conséquences

- Les specs sont mises à jour en v1.1 avec une note de mapping (voir liens ci-dessous) plutôt que
  de réécrire l'app en SwiftUI.
- La vérification Ed25519 se fait en JS pur (`@noble/ed25519`, compatible Hermes) — auditable,
  sans dépendance native à compiler.
- Aucune donnée de santé n'est impliquée dans ces fonctionnalités : l'état de lecture reste
  local (MMKV), comme exigé.

## Liens

- `../feature-spec-prevention-and-health.md` (v1.1, §3 note d'implémentation)
- `../feature-spec-eco-brand-directory.md` (v1.1)
- `../implementation-plan-content-features.md` (v1.1, §2.1/§3.2)

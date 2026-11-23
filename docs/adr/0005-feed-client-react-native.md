# ADR-0005 — ContentFeedClient côté app (React Native) : vérification Ed25519, cache atomique MMKV

Version: 1.0
Date: November 22, 2026
Status: Accepted

## Contexte

Le plan prévoit un `ContentFeedClient` iOS (Swift) : fetch du manifeste avec
ETag/If-None-Match, vérification de la signature Ed25519 avec clé épinglée AVANT
remplacement du cache, cache local pour le hors-ligne avec « swap atomique ».
L'app est en React Native (ADR-0001).

## Décision

Implémentation TypeScript dans `ecocyclea/src/data/content/` :

| Aspect | Choix | Pourquoi |
| --- | --- | --- |
| Ed25519 | `@noble/ed25519` v2 (JS pur, synchrone) | Auditable, zéro dépendance native, fonctionne dans Hermes. `sha512Sync` est câblé manuellement (`@noble/hashes/sha2.js`) car Hermes n'expose pas WebCrypto |
| sha256 fichiers | `@noble/hashes` v2 | Idem, synchrone |
| Cache | MMKV chiffré AES-256 existant (`secureStorage`) | Déjà chiffré at rest (mieux qu'un cache Core Data/fichiers en clair pour du contenu santé) |
| Swap atomique | écriture dans des clés `feed.staging.*`, puis bascule des clés live, puis nettoyage | chaque `set` MMKV est atomique ; un crash laisse l'ancien cache intact ; aucun contenu non vérifié n'est jamais écrit en live |
| ETag | `If-None-Match` sur le manifeste, 304 géré | polling bon marché (plan §1) |
| Images | cache disque de `Image` RN (+ cache app lors du rendu) | suffisant pour le hors-ligne après premier chargement ; pas de lib FS ajoutée en v1 |
| État de lecture | MMKV (`feed_read_articles`) | 100 % local, rien ne quitte l'appareil (spec santé §3) |

Règles de sécurité appliquées dans `feedClient.ts` : URL de contenu en **HTTPS
uniquement** ; signature Ed25519 vérifiée **avant** toute écriture ; sha256 de
chaque fichier vérifié contre le payload signé ; version du manifeste strictement
croissante (anti-rollback) ; en cas d'échec, le **dernier cache valide est
conservé** et aucune donnée non sûre n'est exposée.

## Tests

`__tests__/contentFeed.test.ts` (12 tests) : signature valide acceptée, mauvaise
signature rejetée (cache conservé), sha256 non conforme rejeté, 304, version
non croissante refusée, URL non-HTTPS refusée, erreur réseau, canonicalisation
identique à la CI, et vérification du **vrai manifeste** buildé par
`ecocyclea-content/tools/build-feed.mjs` contre la clé épinglée dans le bundle.

## Conséquences

- Metro/Jest transforment `@noble/*` (ESM) via `transformIgnorePatterns`.
- La clé publique épinglée (`src/core/config/feed.ts`) doit être mise à jour dans
  une release app AVANT la rotation du secret CI (OPERATIONS.md §1).

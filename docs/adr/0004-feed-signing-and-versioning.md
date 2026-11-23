# ADR-0004 — Contrat de signature et de versionnement du flux de contenu

Version: 1.0
Date: November 22, 2026
Status: Accepted

## Contexte

Le plan d'implémentation exige un flux JSON signé (Ed25519), vérifié côté app **avant** tout
remplacement du cache, avec rollback possible et polling bon marché (ETag).

## Décision

- **Payload signé** : `payload = { version, files: { "<name>.fr-FR.json": { url, sha256 } } }`.
  La signature Ed25519 est **détachée** : elle porte sur le JSON canonique (clés triées) du
  payload, encodé en hex (128 caractères) dans `manifest.fr-FR.json`.
- **Clés** : paire Ed25519 générée par `tools/keygen.mjs`. La clé privée (PKCS8 PEM) est un
  secret CI (`FEED_SIGNING_PRIVATE_KEY`) ; la clé publique brute (32 octets, hex) est
  **épinglée dans le bundle de l'app** (`src/core/config/feed.ts`).
- **Version** : timestamp ISO du build (`new Date().toISOString()`), strictement croissant.
- **Intégrité par fichier** : chaque fichier de contenu est vérifié par son `sha256` du payload
  après téléchargement.
- **Publication** : chaque build est uploadé deux fois sur le stockage S3-compatible :
  - `feeds/fr-FR/latest/<file>` — cache court (`max-age=300`) ;
  - `feeds/fr-FR/versions/<version>/<file>` — immuable (`max-age=31536000, immutable`).
  Le manifeste de la version archivée pointe vers les URL versionnées : **rollback instantané**
  en repointant `latest/` (ou une URL de version) sans rebuild.
- **Polling** : requêtes conditionnelles `If-None-Match`/`ETag` (ETag fourni par le stockage
  objet) → 304 quand rien n'a changé.
- **Builds PR** : signés avec une clé éphémère (`DEV_EPHEMERAL_KEY=1`) pour valider le pipeline
  sans exposer le secret ; jamais publiés.

## Conséquences

- L'app n'accepte un manifeste que si (1) signature Ed25519 valide avec la clé épinglée,
  (2) `version` > version du cache, (3) sha256 de chaque fichier téléchargé conforme.
  Sinon : conservation du dernier cache valide, aucune donnée non sûre affichée.
- Algorithme de canonisation documenté dans `tools/lib/canonical.mjs` et répliqué côté app.

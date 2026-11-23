# Implementation Plan – Prevention/Health Section & Eco-Friendly Brand Directory

Version: 1.1
Date: November 22, 2026

> **Note d'implémentation (v1.1, [ADR-0001](adr/0001-platform-react-native.md)) :** les
> mentions « SwiftUI » de la v1.0 désignent des composants React Native dans l'app livrée ;
> « Core Data » → stockage chiffré MMKV ; « SFSafariViewController » → `ASWebAuthenticationSession`.
> Le contrat du flux signé (Ed25519, manifeste, ETag, rollback) est inchangé — voir
> [ADR-0004](adr/0004-feed-signing-and-versioning.md).

Scope: the two content-driven features described in:
- [feature-spec-prevention-and-health.md](feature-spec-prevention-and-health.md)
- [feature-spec-eco-brand-directory.md](feature-spec-eco-brand-directory.md)

---

## 1. Core Design Decision: One Shared Content Feed

Both features share the same delivery mechanism. This is the answer to "how can we implement this" and "how do we update the list":

> **All editorial content (health articles, vetted links, eco-brands) lives in a private content repository. A CI pipeline validates it, produces versioned JSON files, signs them, and publishes them to static hosting (CDN). The app fetches the feed on launch (stale-while-revalidate) and caches it for offline use.**

This gives us:

- **Updates without app releases** (the user's requirement for both features)
- **Review-gated publishing** (gynecologist sign-off for health; rubric review for brands), enforced by CI
- **No user data in the pipeline** → no HDS constraint for the content layer; the app keeps health data on-device
- **One architecture to test**, two content types

```
 ┌────────────────────────┐        ┌──────────────────────────┐
 │ Health markdown drafts  │        │ Brand submissions queue  │◄─ in-app form (no personal data)
 │ (team + gynecologist)  │        │ (open user submissions)  │
 └──────────┬────────────┘        └───────────┬──────────────┘
            │ gynecologist sign-off             │ team rubric review (weekly)
            ▼                                   ▼
      ┌─────────────────────────────────────────────┐
      │   Content repo (source of truth, Markdown/JSON)│
      └───────────────────┬─────────────────────────┘
                          │  CI: schema validation, checks
                          │  (sign-off present, score ≥ 60, links https, lints)
                          ▼
              ┌───────────────────────────┐
              │ Feed builder → signed JSON │  (version = timestamp)
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │  Static hosting + CDN      │  (OVH Object Storage / Cloudflare R2)
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │  iOS app: fetch on launch, │
              │  ETag/version check, cache  │
              │  offline-first reading      │
              └───────────────────────────┘
```

### Versioning & security contract

- `manifest.fr-FR.json` contains `version` (ISO timestamp), content file URLs, and a **detached signature** (Ed25519) of the feed payload.
- The app pins the **public key in the app binary** and verifies the signature before replacing cached content. This protects against CDN tampering (a real risk for health advice).
- Conditional requests via `ETag`/`If-None-Match` → cheap polling, negligible hosting cost (~€1–5/month scale-independent).
- Rollback: previous feed versions remain available at timestamped URLs; the app can be pointed back instantly by editing one URL.

## 2. Feature A – Prevention & Health (« Prévention & Santé »)

### 2.1 App side

| Component | Implementation |
| --- | --- |
| Content models | Codable structs: `Article`, `Link`, `ReviewBadge`, synced from the feed |
| Local cache | Files in the app container (weekly full replace, atomic swap), plus Core Data only for read-state (on-device) |
| UI | SwiftUI: category grid → article list → reader (native Markdown rendering, callouts, FAQ block) |
| Links | `SFSafariViewController` over vetted URLs, https-only, domain shown + copy button |
| Offline | Cache-first; pull-to-refresh; error state uses last-good feed (never a blank screen) |

### 2.2 Content side

| Component | Implementation |
| --- | --- |
| Repo layout | `content/health/<category>/<slug>.md` + YAML frontmatter; `content/brands/brands.fr-FR.json` |
| Review flow | PRs per article; CI blocks published articles without `validatedBy`/`validatedAt`; gynecologist approves via preview page or their preferred channel |
| CI checks | Frontmatter schema validation (JSON Schema), category whitelist, https-only links, reading-time auto compute, staleness report (>12 months) |
| Publish | On merge to `main`, CI builds signed JSON → uploads to CDN → cache purge |

### 2.3 Editorial workflow ("how the gynecologist's links get in")

1. Gynecologist sends or drafts content, including the vetted external links (URL + source name + why it's trusted).
2. Team formats into the article template, opens a PR, gynecologist gets a preview link on their phone.
3. Gynecologist approves → sign-off metadata set → merged → published within minutes, no app update needed.

## 3. Feature B – Eco-Friendly Brand Directory (« Marques engagées »)

### 3.1 The update mechanism (how we update the brand list)

**Path 1 – User submissions (primary, continuous):**

```
In-app anonymous form ──► POST /submissions (Cloudflare Worker or OVH API, rate-limited)
                        ──► Queue (internal review page: list, evidence links, dupes)
Weekly review ──► accepted: entry added to content/brands/brands.fr-FR.json (PR)
                ──► feed update: live for all users without app release
```

**Path 2 – Team edits:** same PR pipeline as health content (score updates, corrections, new certifications).

**Path 3 – Removal/rating change:** any brand can be downgraded or removed instantly via the feed; the app drops it from the next cache refresh. Report actions from users feed the same review queue.

### 3.2 App side

| Component | Implementation |
| --- | --- |
| Models | Codable structs: `Brand`, joined with a small in-app label catalog (`made-in-france`, `oekotex`, …) for consistent display and tooltips |
| UI | SwiftUI: filterable `LazyVGrid` / list; brand detail page; search via local index |
| Submission | Form → JSON POST; success screen with a **submission code** (random 8-char) so users can check status without an account |
| Status check | `GET /submissions/<code>` returns one of `pending/accepted/published/rejected` – no personal data |
| Anti-spam | Signed request (HMAC with rotating app-token + rate limit per device); anonymous, resettable device token only |

### 3.3 Brand scoring

- Rubric v1.0 (materials 30%, French footprint 25%, durability 20%, certifications 15%, packaging 10%); score stored in the feed with `rubricVersion`.
- CI/edit tooling keeps score and rubric version consistent (score without matching rubric → build error).
- v1 scoring is manual during the scheduled weekly review session (~30 min/week); an LLM-assisted pre-screen can support it later without changing anything downstream.

## 4. Milestones

Assumes a single developer + designer + gynecologist partner; ~1 day/week of dev capacity for content features; adjust with actual availability.

### Phase 0 – Content feed foundations (Weeks 1–2)

- [x] Create the `ecocyclea-content` repo; move this `docs/` folder into it (see [doc-maintenance.md](doc-maintenance.md)) and set up docs CI checks
- [x] Content repo scaffold, Markdown templates, JSON Schemas
- [x] CI: validation + signed feed build + CDN upload/purge
- [x] `ContentFeedClient` (fetch + ETag/If-None-Match, vérification Ed25519 avec clé épinglée avant remplacement du cache, cache MMKV chiffré avec swap atomique, fallback hors-ligne sur le dernier bon cache) — voir [ADR-0005](adr/0005-feed-client-react-native.md), code dans `ecocyclea/src/data/content/`, tests dans `__tests__/contentFeed.test.ts`
- **Exit:** a test article edited in the repo appears in-app < 10 min later, no release.

### Phase 1 – Prevention & Health MVP (Weeks 3–5)

- [x] Article list/reader UI (categories, spotlight, search) — `HealthHomeScreen`, `HealthCategoryScreen`, `ArticleReaderScreen`
- [x] Review badge + sources block + liens in-app (ASWebAuthenticationSession, domaine visible, URL copiable) + disclaimer UI — ADR-0001/0006
- [ ] Gynecologist walkthrough: hand-off day + PR-based sign-off (aim ≥ 10 launch articles) — **processus humain, hors code** ; 2 articles exemples livrés
- [ ] Onboarding teaser card (privacy-respecting: no read tracking beyond local) — carte d'accueil livrée à la place (HomeScreen)
- **Exit:** all acceptance criteria in the health spec pass; gynecologist successfully publishes alone (assisted dry run).

### Phase 2 – Brand directory MVP (Weeks 6–8)

- [x] Brand list/detail UI + filters + label catalog — `BrandDirectoryScreen`, `BrandDetailScreen`, `labelCatalog.ts`
- [x] Rubric v1.0 defined and published (`docs/rubric-brand-v1.0.md`) ; backlog seeded with 3 example brands (target 15–20 at launch — **reste à faire côté éditorial**)
- [x] Submission Worker (`submissions-worker/`, D1+KV) + queue/review page + in-app form + status by code — tested end-to-end with Miniflare (7/7)
- [x] Report/suggest-update actions — `POST /reports` (file de revue), repli mailto hors ligne
- **Exit:** full submission→review→publish cycle exercised end-to-end with no developer involvement in the final mock run.

### Phase 3 – Hardening & observability (Weeks 9–10)

- [x] On-device privacy checks: no read data, no submission identifiers beyond the anti-spam token — audit `grep` (seuls `feedClient` et `submissionsClient` font du réseau ; aucune donnée de santé n'est émise) + tests
- [x] CDN/rollback drill: versions horodatées `versions/<version>/` publiées à chaque build ; app refuse les versions non croissantes (test) ; swap atomique MMKV (test)
- [ ] Crash/HTTP error monitoring around feed parsing (sentry-level logging, no content data) — **non fait (hors scope de cette livraison)**
- [ ] App Store metadata updates these features (relevant for review notes and privacy nutrition labels) — **à faire côté store/**

### Beyond MVP (indicative, not scheduled)

- Lightweight web editor for the gynecologist (no Git required)
- Screening/reminders ("Next HPV test due") linked to article topics
- Brand partnerships page with explicit « Partenaire » labeling
- Second health reviewer (medical board) and multi-locale feeds

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Gynecologist becomes a bottleneck | Content stale | Batch review sessions (2/mo); templates reduce effort; CI staleness report |
| Greenwashing slips through/legal claim issue | Reputation | Published rubric, evidence requirement, rejection log, report action |
| CDN tampering / MITM | Wrong health info shown | Pinned signature verifications – feed shown only if signature checks pass |
| App review (Apple) rejects external links | Delay | Links open in SFSafariViewController (allowed), displayed as curated resources |
| Submissions spammed | Queue burden | Rate limiting, dedupe by domain, weekly review batching |
| Rubric disagreements | Team friction | Versioned rubric, changes logged with rationale |

## 6. Trackers & Artifacts

- Private repos: `ecocyclea-content` (business data), `ecocyclea-ios`
- Work tracked in this project's task board; acceptance criteria from the two feature specs become the issues' DoD checklist
- This plan, the feature specs, and the product spec live in `~/Documents/projects/ecocyclea/docs/` and remain canonical

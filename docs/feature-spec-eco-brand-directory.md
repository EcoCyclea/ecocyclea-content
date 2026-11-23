# Feature Spec – Eco-Friendly Brand Directory

**« Marques engagées »** – French ecological menstrual & intimate care brands

Version: 1.1
Date: November 22, 2026
Status: Draft

> **Note d'implémentation (v1.1, [ADR-0001](adr/0001-platform-react-native.md)) :** l'app
> livrée est en React Native. Le « navigateur in-app avec domaine affiché » est réalisé via
> `ASWebAuthenticationSession` ; le stockage local chiffré (état de lecture, jeton anti-spam
> de l'appareil) utilise MMKV chiffré AES-256. Le backend de soumission retenu est un
> **Cloudflare Worker** (table D1 + rate-limit), conformément à §6.

---

## 1. Summary

An in-app directory of ecological French brands for menstrual and intimate care (period underwear, cups, organic tampons/pads, zero-waste accessories). The list:

- is **delivered remotely** through the same signed JSON content feed as the health section, so it updates without an app release;
- accepts **open submissions from users**, which are **reviewed against a published rubric before publishing**;
- stays **editorially neutral**: inclusion is based on criteria, not payment (disclose any future partnership or affiliate link explicitly).

## 2. Goals & Non-Goals

### Goals

- Help users discover ecological alternatives with transparent, criteria-based information (materials, certifications, made-in-France, reusability).
- Keep the list fresh via lightweight user submissions (the community scouts brands; the team validates).
- Be greenwashing-proof: every published entry passes a documented review, and criteria are visible in-app.

### Non-Goals (this version)

- E-commerce, price comparison, or affiliate links inside the app (a later phase may add partnerships, with visible disclosure).
- Automatic scoring from scraped data; scores are editorial, produced during review.
- Brand accounts (brands cannot self-publish; they go through the same submission path, flagged as "brand claim").

## 3. User Experience

### Entry point

- Tab or home card: **« Marques engagées »**, near the sustainability features.

### Browsing

- Filter by category: `culottes menstruelles`, `cups`, `tampons & serviettes bio`, `zéro déchet`, `lingerie/soins`
- Filter by labels: Made in France, GOTS, OEKO-TEX, Ecocert, B Corp, etc.
- Search by name.

### Brand page (in-app)

- Name, logo (cached assets), one-line pitch, description (≤ 300 chars)
- Category chips, certifications/labels (recognized only, with explanation tooltips)
- Sustainability highlights (3–5 bullets from the review: materials, manufacturing location, end-of-life, packaging)
- Price range indicator (no live pricing)
- **website link** (in-app browser, domain shown) + Instagram handle if relevant
- « Why this brand? » link to the published criteria rubric
- "Suggest an update for this brand" and "Report a brand" actions
- Reviewed-at date; if a brand's info is older than 12 months, a "verify current info" notice is shown

### Submission flow (user → review queue)

1. In-app form à « Proposer une marque » : brand name, website or Instagram URL, category, why it's ecological – pre-filled with a rubric summary.
2. **No account required; no personal data collected.** Submission is anonymous by default; no email field in v1.
3. Confirmation: « Merci ! Votre suggestion sera examinée par l'équipe » + status lookup by submission code (returns review state: pending / accepted / rejected / published).
4. Reviews happen at a fixed cadence (target weekly) by the team, using the rubric.
5. Accepted submissions are merged into the content source-of-truth and rolled out with the next feed update.

### Dashboard/status page

A lightweight public web page lists recently added brands, pending submissions, and rubric changes – transparency reinforcing anti-greenwashing positioning.

## 4. Review Rubric (published, transparent)

Each criterion is checked during review; evidence is required (links to brand pages, certification registries labels):

| Criterion | Weight | Examples / evidence |
| --- | --- | --- |
| Materials | 30% | Organic (GOTS), natural, recycled; transparent material list |
| French footprint | 25% | Made in France, ateliers in France, French company |
| Durability/reusability | 20% | Reusable products, durability guarantees, repairability |
| Certifications & labels | 15% | OEKO-TEX, GOTS, Ecocert, B Corp, ADEME-recognized labels |
| Packaging & end-of-life | 10% | Minimal/recyclable packaging, take-back programs |

Rules:

- **Minimum score to publish**: 60/100 and no critical rejection trigger (e.g., unverifiable claims, greenwashing language without evidence, health-safety red flags).
- Documented rejection reasons per entry (kept internally for consistency).
- V1 uses trained human judgment on top of the rubric (LLM pre-screen may be added later).
- Amendments to the rubric are versioned and mentioned in-app.

## 5. Governance

| Role | Responsibility |
| --- | --- |
| User community | Suggests brands, reports issues |
| Ecocyclea team (moderator) | Reviews against the rubric, verifies evidence, publishes/rejects |
| Partner gynecologist (medical safety) | If a brand entry touches a health claim, it requires medical review – rare in practice |

## 6. Feed Data Model (Summary)

```jsonc
// brands.fr-FR.json (part of the content feed)
{
  "version": "2026-11-21T…",   // same signed manifest as articles
  "rubricVersion": "1.0",
  "brands": [
    {
      "id": "brand-0031",
      "name": "Elia",
      "slug": "elia",
      "tagline": "Culottes menstruelles françaises",
      "description": "…",
      "categories": ["culottes"],
      "labels": ["made-in-france", "oekotex"],
      "sustainabilityHighlights": ["Coton bio", "Fabrication en France"],
      "score": 82,                     // from rubric v1.0
      "rubricVersion": "1.0",
      "url": "https://…",
      "priceRange": "€€",
      "reviewedBy": "Ecocyclea team",
      "reviewedAt": "2026-11-18",
      "regions": ["fr-FR"]
    }
  ]
}
```

### Submission backend (MVP)

- In-app form → HTTPS POST to a minimal write endpoint (Cloudflare Worker or OVH API) → persisted to a private queue (e.g., a table reviewed in a simple internal page).
- Contains no personal data; rate-limited by device (client-generated anonymous token, resettable).
- Reviewed weekly; publish path goes through the content repo + feed update.

## 7. Compliance & Legal Notes

- Directory content contains **no user or health data** → the feed and submission queue do not require HDS hosting (revisit if we ever store identifiable submissions).
- Editorial neutrality: no brand pays to appear or to score higher; any future partnership is labeled « Partenaire » on the entry itself.
- Review-at dates and rubric versioning provide the audit trail.
- Anonymous submissions designed for GDPR minimalism (no account, no email, no identifiers beyond a device-level anti-spam token).

## 8. Acceptance Criteria

- [ ] Directory browsable offline (cached feed) with category/label filters and search.
- [ ] Each brand page shows certifications, sustainability bullets, website link, reviewed-at date and rubric version.
- [ ] Submission works without an account, confirms to the user, and never asks for personal data.
- [ ] New brand added and published with **zero** app changes (feed updated via next launch/refresh).
- [ ] Report/suggest-update actions reach the team queue.
- [ ] Rejected submissions never appear in UI anywhere.

## 9. Metrics

| Metric | Target |
| --- | --- |
| Submissions / month | ≥ 20 (post-launch) |
| % of submissions accepted & published | ≥ 30% |
| Directory entry point open rate | ≥ 15% of MAU |
| External website CTR from directory | measured (baseline) |
| Report rate per 1k views | < 2 |
| Brands reviewed within 7 days of submission | ≥ 80% |

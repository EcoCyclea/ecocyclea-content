# Ecocyclea – Product Specification

Version: 1.0 (initial draft)
Date: November 21, 2026
Owner: Florian Dutronc
Status: Draft – open for review

---

## 1. Product Overview

**Ecocyclea** is a privacy-first period and cycle tracking app for the French market, differentiated by three pillars:

1. **Medical credibility** – the only cycle tracker whose educational content is authored and validated by a French partner gynecologist.
2. **Radical privacy** – on-device storage of health data by default; minimal collection; transparent practices aligned with HDS/CNIL/GDPR expectations.
3. **Ecological engagement** – sustainability tracking and a curated directory of ecological French menstrual care brands.

### Unique Value Proposition (France)

> « Le seul suivi de cycle dont le contenu de santé est validé par des gynécologues français – avec vos données sur votre appareil. »

### Target Market

- ~33M women of reproductive age (15–49) in France
- French users strongly prefer medically validated, discreet, privacy-respecting apps (see market research, Aug 2026)
- No French competitor (My Elia, Maya, Mon Cycle) combines gynecologist validation, HDS-aligned privacy, and sustainability features

---

## 2. User Personas

| Persona | Needs | Key features |
| --- | --- | --- |
| Léa, 27 – General tracker | Simple logging, discretion, no ads | Fast logging, neutral UI, minimal notifications |
| Camille, 32 – Pregnancy planner/planner-avoider | Reliable predictions, privacy | Predictions, fertile window, on-device data |
| Manon, 24 – Eco-conscious | Sustainable alternatives, low waste | Eco-brand directory, product tracker, sustainability content |
| Sophie, 46 – Perimenopause | Symptom management, trusted information | Premenopause tracking, gynecologist-validated content |
| Teens 15–18 | Education, privacy from parents | Vetted educational content, discreet design |

---

## 3. Feature Set

### 3.1 Core (MVP)

| Feature | Priority | Notes |
| --- | --- | --- |
| Period & ovulation tracking | ★★★★★ | On-device predictions (3–6 months ahead) |
| Symptom & mood tracking | ★★★★ | Customizable categories, local storage |
| On-device data storage | ★★★★★ | SQLite/Core Data, encrypted at rest |
| Data export / delete | ★★★★★ | JSON/CSV export, 1-tap delete |
| French-first UI | ★★★★★ | Native language, neutral palette, discreet notifications |
| iCloud backup (opt-in) | ★★★ | Encrypted, optional |

### 3.2 Differentiators

| Feature | Status | Spec |
| --- | --- | --- |
| **Prevention & Health section** | Planned (this release) | [feature-spec-prevention-and-health.md](feature-spec-prevention-and-health.md) |
| **Eco-friendly brand directory** | Planned (this release) | [feature-spec-eco-brand-directory.md](feature-spec-eco-brand-directory.md) |
| Sustainability tracker (product carbon footprint) | Planned (next) | Pre-populated impact database |
| Telehealth integration (Doctolib/Qare/Alan) | Planned (later) | Requires opt-in cloud sharing, HDS hosting |
| Gynecologist clinical dashboard | Planned (later) | Consent-gated data sharing |
| Wearable integration (HealthKit, Oura) | Planned (later) | Via HealthKit where possible |

### 3.3 Explicitly Out of Scope (MVP)

- Cloud sync of health data (unless user opts in with HDS-certified hosting)
- Ads and third-party data sharing (never)
- Community features, gamification beyond subtle statistics (deferred; validate with user interviews)

---

## 4. Governance Model

Two editorial domains, two governance models:

1. **Medical/health content** – authored and validated by **one partner gynecologist**. Nothing publishes without their review, and their review is displayed in-app ("Validé par Dr. …").
2. **Ecological brand directory** – **open user submissions**, moderated and reviewed by the Ecocyclea team against a published, transparent criteria rubric before publishing.

Both are delivered to the app through the same **remote content feed** (signed JSON over HTTPS), so content updates never require an app release.

---

## 5. Privacy & Compliance

| Requirement | Approach |
| --- | --- |
| HDS certification | Required for any hosted *personal health data*. Content feeds contain **no user data**, so static hosting is acceptable for them; the app stores health data on-device. Cloud features (telehealth, doctor dashboard) come later and will require HDS-certified hosting (OVHcloud/Exoscale). |
| GDPR / CNIL | Explicit consent, data minimization, user rights (access, deletion, portability) |
| Health content liability | Content is general educational information, not personalized medical advice; in-app disclaimer required |
| User submissions | Anonymous by design; no account or personal data required to submit a brand |

---

## 6. Monetization (Working Model)

- One-time purchase (19,99 €) for premium features – preferred by French users per market research
- Free tier: full core tracking, generous limits
- Optional later subscription only for telehealth services (4,99 €/mois)
- No ads. No data monetization. Ever.

---

## 7. Success Metrics

| Area | Target |
| --- | --- |
| Content feature weekly engagement (any interaction with Health or Brand section) | ≥ 25% of MAU |
| Content feed update frequency | ≥ 1 update / month |
| Brand submissions per month | ≥ 20 (post-launch) |
| % published brand submissions | ≥ 30% |
| App Store rating | ≥ 4.5 |
| 3-month retention | ≥ 60% |

---

## 8. Open Questions (Product Level)

1. Which HDS-certified host for future cloud features (OVHcloud vs Exoscale)?
2. Will the partner gynecologist be named publicly (brand credibility) or anonymous?
3. Should brand partnerships (Elia, Dans Ma Culotte…) be pursued commercially, or is the directory strictly neutral during MVP validation?
4. Results of user interviews (10–20, using the uploaded French questionnaire) may reorder the roadmap.

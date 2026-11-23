# Feature Spec – Prevention & Health Section

**« Prévention & Santé »**

Version: 1.1
Date: November 22, 2026
Status: Draft – awaiting medical partner input

> **Note d'implémentation (v1.1, [ADR-0001](adr/0001-platform-react-native.md)) :** l'app
> livrée est en React Native, pas SwiftUI. « SFSafariViewController » est implémenté par
> `ASWebAuthenticationSession` (navigateur in-app, domaine visible, URL copiable depuis l'UI) ;
> l'état de lecture local est stocké dans le stockage chiffré MMKV (équivalent Core Data) ;
> le rendu Markdown est natif in-app. Le comportement exigé par cette spec est inchangé.

---

## 1. Summary

An in-app educational section with prevention and women's health content, whose articles, advice, and external links are **authored and validated by our partner gynecologist**. Content is delivered through a **remote content feed** (signed JSON over HTTPS), so it can be updated, corrected, and expanded without releasing a new app version.

This is the product's credibility anchor and a direct competitive differentiator: no French competitor has gynecologist-validated educational content.

## 2. Goals & Non-Goals

### Goals

- Give users trustworthy, medically reviewed, French-language information about their cycle and gynecological health.
- Redirect users to authoritative external resources (links) vetted by the gynecologist, e.g. official health bodies and professional organizations.
- Make the review status visible and auditable: every item shows the reviewer, their title, and the review date.
- Update content at any time, without an app store release.

### Non-Goals (this version)

- Personalized medical advice or diagnosis ("you may have endometriosis" is out; "these symptoms are commonly discussed with a doctor, here's why" is in).
- Chatbot or AI-generated medical answers.
- Collecting any user data through the section (no reading history stored server-side; read state stays on-device).
- Multi-reviewer medical board (current governance: one partner gynecologist; extensible later).

## 3. User Experience

### Entry point

- Tab or home-screen card: **« Prévention & Santé »**
- Subtle, neutral styling per French design preferences (no "cutesy" language; use professional/medical wording).

### Structure

```
Prévention & Santé
├── À la une (spotlight)          – 1–3 pinned items, e.g. vaccination or screening campaign
├── Catégories
│   ├── Mon cycle                 – how the cycle works, what's normal vs not
│   ├── Contraception             – methods, questions to ask your doctor
│   ├── Dépistage & prévention    – screenings by life stage, prevention checklists
│   ├── Infections (IST)          – prevention, testing, resources
│   ├── Fertilité & grossesse     – basics, when to consult
│   ├── Ménopause & péri-ménopause
```

### Content item, in detail

- Title + summary card (« 2 min de lecture » reading time)
- Body rendering from structured content (headings, paragraphs, lists, callouts, FAQ) – Markdown in the feed, rendered natively
- **« Sources & liens utiles »** block: vetted external links (name of source, short description, URL), opened in in-app Safari (SFSafariViewController) with domain shown
- **Review badge:** « Validated by Dr. [Name], gynecologist » + review date
- "Report content" action (opens a prefilled email/web form) – content errors are a medical-liability issue
- Related tracking prompt where relevant and optional, e.g. Article "Tracking pain" → suggestion "Log pain in your cycle tracking" with an opt-in button. No tracking prompt is automatic, and nothing about article reads leaves the device.

### Offline behavior

- Last successfully fetched content is cached on-device and fully available offline.
- Fetch on app launch if online (stale-while-revalidate), plus pull-to-refresh in the section.

## 4. Governance & Editorial Workflow

**Single partner gynecologist** is the sole medical authority.

### MVP workflow: Git-based review / validation channel

1. Content lives in a private Git repository (the **content source-of-truth**): articles are Markdown files with YAML frontmatter (category, tags, links, review metadata).
2. Drafts can be written by the team or by the gynecologist, using shared templates.
3. The gynecologist reviews them through a simple preview web page automatically served from the repo (Netlify/Vercel preview), or their review channels such as email/marking up an HTML version, whatever they prefer.
4. On approval, the gynecologist's sign-off is recorded in the article's frontmatter (`validatedBy`, `validatedAt`); any later edit resets the validation state and requires a new sign-off.
5. Publish: CI validates schema, builds the fat JSON feed, signs it, uploads to hosting, and bumps the CDN cache.

### Editorial guarantees (enforced in CI when possible)

- An item with `status: published` **must** have validation metadata (reviewer, date) and at least one source link per claim-heavy article.
- Automatic re-check: articles older than 12 months are flagged for re-validation (staleness list surfaced by CI; no auto-unpublish).
- Emergency retraction or edit can be pushed in minutes without an app release.

### Later management of the content (Phase 2+)

- A lightweight authenticated web editor (forms, no Git knowledge required) that generates the same pull-request/approval flow behind the scenes; the sign-off action still belongs to the gynecologist.

### Editorial workflow (draft → approved → publish pipeline)

The full pipeline – draft → gynecologist review → sign-off → feed build → in-app verification – is specified in [implementation-plan-content-features.md](implementation-plan-content-features.md).

## 5. Legal & Compliance Notes

- **Educational disclaimer** (fixed footer + article footer): general information, does not replace a consultation with a healthcare professional.
- Content contains **no personal data**, so the feed can be statically hosted without HDS certification; HDS applies to anything that stores or processes users' health data (current design: none for this section).
- All claims must cite a source (link vetted by the gynecologist; authoritative sources include institutional/official health bodies and professional societies, to be locked in with the gynecologist).
- Reviewer attribution shown in-app only with the gynecologist's written consent (open question, product-spec §8.2).

## 6. Feed Data Model (Summary)

```jsonc
// feed manifest
{
  "version": "2026-11-21T…",   // ISO timestamp, monotonically increasing
  "signature": "…",            // detached signature of the payload (see security section)
  "locales": { "fr-FR": { "articlesUrl": "https://cdn…/articles.fr-FR.json" } }
}

// article (fr)
{
  "id": "art-0007",
  "slug": "depistage-cancer-col-25-30-ans",
  "category": "depistage-prevention",
  "title": "Dépistage du cancer du col de l'utérus : ce qu'il faut savoir",
  "summary": "…",
  "readingMinutes": 4,
  "body": "…markdown…",
      "tags": ["depistage", "cancer", "prevention"],
  "spotlight": false,
  "links": [
    { "label": "Ameli – dépistage", "url": "https://…", "source": "Assurance Maladie", "description": "…" }
  ],
  "validatedBy": "Dr. [Name]",   // optional if consent (alias otherwise)
  "validatedByTitle": "Gynécologue",
  "validatedAt": "2026-11-20",
  "publishedAt": "2026-11-21",
}
```

Full contract details: [implementation-plan-content-features.md](implementation-plan-content-features.md).

## 7. Acceptance Criteria

- [ ] User can browse all categories and read articles fully offline (cached).
- [ ] Every published article displays reviewer badge + review date + sources.
- [ ] Adding/correcting an article and publishing requires **zero** app changes; the app picks up new content on next launch or pull-to-refresh.
- [ ] Tapping a vetted link opens the in-app browser with visible domain; the user can copy the URL.
- [ ] Report-content action creates a prefilled feedback draft with article id.
- [ ] Feed integrity checked when loaded (signature/versioned – see implementation plan).

## 8. Metrics

| Metric | Definition |
| --- | --- |
| Section open rate | opens / MAU |
| Article read rate | articles read to ≥ 80% of content per week / MAU |
| External link CTR | link taps / article views |
| Report rate | reports / 1k reads (target < 1) |
| Content staleness | % of feed articles older than 12 months without revalidation (target 0) |

# Ecocyclea – Documentation Index

Version: 1.1
Date: November 22, 2026
Status: Canonical — this folder now lives in the `ecocyclea-content` repository (ADR-0002)

Product documentation for **Ecocyclea**, a privacy-first, gynecologist-endorsed period tracking app for the French market with an ecological focus.

## Documents

| Document | Purpose |
| --- | --- |
| [Product Specification](product-spec.md) | Overall product spec: positioning, users, feature set, compliance, monetization |
| [Feature Spec – Prevention & Health Section](feature-spec-prevention-and-health.md) | Gynecologist-vetted health education content delivered via a remote content feed |
| [Feature Spec – Eco-Friendly Brand Directory](feature-spec-eco-brand-directory.md) | Curated list of ecological French brands with open user submissions and review workflow |
| [Implementation Plan – Content Features](implementation-plan-content-features.md) | Phased plan, architecture, data model, and milestones for the two content features |
| [Documentation Maintenance Protocol](doc-maintenance.md) | How these docs stay current during implementation: docs-as-code, DoD rules, CI checks, review rituals |

## Source Material

These docs build on two uploaded research documents:

- Comprehensive Market Research: Clue vs Flo period tracking apps (August 2026)
- Period Tracking App: AI Coding Plan & French User Interview Questionnaire

## Key Decisions (Product Direction)

1. **Content delivery:** Remote content feed (signed JSON over HTTPS), updatable without an app release.
2. **Medical governance:** One partner gynecologist authors and validates all prevention/health content.
3. **Brand directory governance:** Open submissions from users, reviewed by the team before publishing.
4. **Documentation language:** English (product UI and content remain French-first).

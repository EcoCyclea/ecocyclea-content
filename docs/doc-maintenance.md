# Documentation Maintenance Protocol

How the Ecocyclea docs stay current during implementation.

Version: 1.1
Date: November 22, 2026
Owner: Florian Dutronc
Applies to: all documents in this folder

> **v1.1 (ADR-0002) :** ce dossier est désormais canonique dans le dépôt `ecocyclea-content`
> (créé en Phase 0). Dans le dépôt app `ecocyclea/`, `docs` est un lien symbolique vers ce
> dossier. Toute modification se fait ici, par PR.

---

## 1. Principles

1. **Docs are code.** They live in version control, change through pull requests, and get reviewed like code.
2. **A feature isn't done until its spec is true.** Updating the spec is part of the Definition of Done, not an afterthought.
3. **Make staleness visible, never silent.** Outdated docs get flagged, not quietly ignored.
4. **Log decisions, don't erase them.** Changes in direction become ADRs; specs link to them.

## 2. Where docs live

| Stage | Location | Role |
| --- | --- | --- |
| Working copy | `~/Documents/projects/ecocyclea/docs/` | Where specs are drafted and edited day-to-day |
| Canonical (from Phase 0) | `ecocyclea-content` repo under `docs/` (same repo as the content source-of-truth) | Single source of truth; renders on the repo web UI |
| App-side updates | `ecocyclea-ios` PRs must either include doc changes in `ecocyclea-content` or state "no doc impact" in the PR description | Keeps code and docs locked together |

Concretely (since Phase 0, ADR-0002): this folder **is** `ecocyclea-content/docs/` — the canonical copy now lives in the `ecocyclea-content` repo and all edits happen there. In the app repo `ecocyclea/`, `docs` is a symlink to `../ecocyclea-content/docs` so existing references keep resolving.

## 3. Rules per document type

| Doc | Update trigger | Frequency floor |
| --- | --- | --- |
| `product-spec.md` | Any change to scope, governance, UVP, metrics, roadmap priorities | Every milestone end |
| `feature-spec-*.md` | Any change to acceptance criteria, UX, data model, governance, or rollout | With the implementing PR |
| `implementation-plan-*.md` | Re-planning, milestone completion, new risks | At each phase exit |
| New `adr/*.md` | Every non-obvious technical or product decision | As decided |

## 4. Definition of Done (per feature/issue)

An issue taken from a feature spec is done only if all of the following hold:

- [ ] All acceptance criteria in the spec pass as written, or the criteria were updated in the same PR (with the reason)
- [ ] Spec `version` incremented and `last-reviewed` date updated
- [ ] Status field reflects reality (`draft / in review / shipped / partially shipped`)
- [ ] Data model / API contract sections match the shipped code exactly
- [ ] If scope changed: a `adr/NNNN-title.md` decision record exists and is linked

## 5. CI checks (added to the content repo pipeline, alongside existing checks)

1. **Metadata check:** every `*.md` in `docs/` must have a `Version:` and `Date:` (or `last-reviewed:`) header; fails the build if missing.
2. **Staleness report:** docs whose date is older than 90 days appear in a CI job summary as a to-review list (warning, not failure).
3. **Internal links:** relative links between docs must resolve (fail the build on broken links).
4. **PR hint:** PRs in `ecocyclea-ios` touching features with a spec get a bot comment: "Does this change `feature-spec-…md`?" (non-blocking, answered in review).

## 6. Review rituals

| Ritual | Cadence | Duration | What happens |
| --- | --- | --- | --- |
| Staleness sweep | Every 2 weeks (aligned with brand review session) | 10 min | Open the CI staleness report; mark specs reviewed or flag `⚠️ Outdated - see ADR-…` |
| Milestone close-out | End of each plan phase | 30 min | Update implementation plan checkboxes, product spec metrics, write ADRs for anything that deviated |
| Doc audit | Quarterly | 1 hour | Full pass: is everything still true? Prune superseded docs; archive rather than delete |

## 7. Outdated flagging convention

When a doc (or section) is known to be stale:

```markdown
> ⚠️ **Outdated (2027-01-15):** section 4 no longer reflects the v2 submission flow. See [adr/0003-submissions-v2.md](adr/0003-submissions-v2.md).
```

Never delete a section silently; never leave a stale section unflagged once noticed.

## 8. Handling implementation reality vs. spec

When the app can't implement what the spec says:

1. Don't fudge the spec to match a hack; first write an ADR explaining the deviation and why.
2. Update the spec to the new intended behavior, linking the ADR.
3. Add the original idea to the "Beyond MVP / revisit" list so it isn't lost.

This mirrors the content workflow (gynecologist sign-off) the product already uses: explicit, recorded approval rather than untracked drift.

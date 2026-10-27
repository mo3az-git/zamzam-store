# Branch Retirement Register — Zamzam MVP (2026-10-27)

This is a **retirement decision register**, not authorization to merge or to run formal TP cases.

**Known facts at audit:** 26 remote branches after owner deleted exactly three legacy UI refs; 15 open Draft PRs; consolidated app [PR #26](https://github.com/mo3az-git/zamzam-store/pull/26) at `12a8550eaa0c375b47e0638eee78ce01aee0f623` passed targeted [CI 40502611708](https://github.com/mo3az-git/zamzam-store/actions/runs/40502611708). PR #26 includes byte-identical backend source from PR #19, frontend from PR #24, proposed schema from PR #25 and MVP-first policy section from PR #20. No real customer checkout is enabled; TP-01 remains unauthorized.

## Preserved source contributions
- PR #18 — archived *byte-for-byte* at `docs/archive/phase2-pr18/` (two documents, checked against blob SHAs). **These docs contain obsolete phrases that block Phase 2 implementation; those phrases are superseded by the owner’s 2026-10-27 MVP-first amendment.** Keep archive for provenance, not executable instructions.
- PR #20 — current owner policy section incorporated in `docs/implementation-plan.md` and preserved verbatim at `docs/owner-mvp-first-policy-20261027.md`. It defers all-59 formal TP to pre-release but keeps TP-01 unauthorized. Retain public release restrictions.
- PR #25 — strict schema, tests and interface handoff integrated under `contracts/` and `docs/mvp-integration-handoff-v1.md`; consolidated CI supersedes the standalone CI runner. Its PR is already closed.
- PRs #19 and #24 — both remain active component source PRs. PR #26 has these *as merge-commit parents*; do not delete their branch refs while the PRs remain open.
- PR #27 — **not** fully integrated; interactive gallery, language switch and isolated component approaches are to be reviewed for selective port. Its `lib/medusa.ts` lacks `region_id` EGP pricing-context fix from PR #24 and its stock/checkout contract differs. Remain open until reconciled.
- PR #23 — separate pure payment quote validator + tests, not in #26. Backend agent must assess and either port or explicitly retire with evidence; never merge old branch wholesale.
- PR #17 — legacy focused-CI selector/tests, not in #26; explicit obsolete-or-port determination required before branch retirement.
- Orphan `phase-1/idempotency-spike` — legacy checkout-lease module and unit test not in #26; backend owner to assess before retirement.
- `phase-1/sprint3-combined-ci` — old CI evidence/docs unique, assess/archive first.
- `feature/oasis-editorial-redesign` and `phase-1/oasis-editorial-preview` — deliberately unselected alternative visual direction; preserve through archival tag/bundle **if historical design assets are desired** before deletion.

## Safe sequencing, **not a single mass-delete operation**

1. Reconcile PR #27 into the **existing** PR #24 branch only. Port valuable UI, retain PR #24 region-aware prices, routes and tests; rerun both workspace CI on consolidated PR #26 after importing new UI.
2. Backend agent assesses PR #23 quote logic, PR #17 targeted CI, orphan idempotency, legacy payment/correlation/checkout branches; record `ported`, `obsolete by specific current implementation`, or `archive` with tested evidence.
3. Close or retarget dependent Draft PRs before deleting any **open PR head/base**: PR #7, #9, #11, #12, #14, #15, #16 plus active sources #19/#24. Retarget only if the actual diff remains useful. Avoid wholesale history merges.
4. Owner’s optional archive tags or offline bundle must preserve historic *divergent* revisions if long-term reproducibility is desired. GitHub PR closure alone is not an archival guarantee.
5. For each actual deletion, re-fetch remote tip SHA, assert the expected SHA and no open PR head/base uses it, check any local active worktrees, and only then delete. GitHub branch ref deletion is not exposed by the connected tools in this conversation.
6. Keep `main`, `phase-1/same-order-native-payment-integration-spike`, `phase-2/catalog-storefront-mvp`, and `integration/mvp-consolidated-20261027` until formally reviewed. **Do not merge to main without owner request** and never run TP-01.

No canonical TP rows/status were edited in the consolidated application tree.

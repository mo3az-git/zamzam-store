# Branch Retirement Register — Zamzam MVP (2026-10-27)

This is a **retirement decision register**, not authorization to merge or to run formal TP cases.

**Known facts at audit:** 26 remote branches after owner deleted exactly three legacy UI refs; 6 open Draft PRs (after closing nine superseded PRs: #7, #9, #11, #12, #14, #15, #16, #18, #20); consolidated app [PR #26](https://github.com/mo3az-git/zamzam-store/pull/26) at `12a8550eaa0c375b47e0638eee78ce01aee0f623` passed targeted [CI 40502611708](https://github.com/mo3az-git/zamzam-store/actions/runs/40502611708). PR #26 includes byte-identical backend source from PR #19, frontend from PR #24, proposed schema from PR #25 and MVP-first policy section from PR #20. No real customer checkout is enabled; TP-01 remains unauthorized.

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

## Safe manual deletion candidates — checked 2026-10-27

**Exact expected remote heads** below must be re-verified immediately before each deletion. None is presently a head/base of one of the remaining six open PRs (#17, #19, #23, #24, #26, #27). **GitHub API writes in this connection cannot delete refs**, so no deletion has occurred through this assistant.

**Ancestry retained by consolidated PR #26 (zero commits missing):**

| Branch | Expected SHA | Retention proof |
| --- | --- | --- |
| `phase-1/technical-compatibility-spike` | `11af3c38b4e3540077e187809e99a5bfdf076d34` | Ancestor of PR #26 |
| `phase-1/inventory-ledger-spike` | `f65d0e77d0264589a00aee3e55336b4c39e29859` | Ancestor of PR #26 |
| `phase-1/inventory-conversion-spike` | `267d469170232006d729ae819dff06adb9c79fd5` | Ancestor of PR #26 |

**Ancestor retained by another existing, later branch (do not delete the later branch first):**

| Branch | Expected SHA | Later reference |
| --- | --- | --- |
| `feature/oasis-editorial-redesign` | `413ce01b91af72ded7cc937edcfa31b151d19fa1` | `phase-1/oasis-editorial-preview` is two commits ahead |
| `phase-1/payment-branch-spike` | `199aa5e30a4a6a32139631bc5f1b0811c949a2fb` | `phase-1/payment-order-binding-spike` is four commits ahead |
| `phase-1/native-checkout-integration-spike` | `47bb150a2a471ae4ec3a8a96a1043a2ac7fbe286` | `phase-1/native-checkout-recovery-spike` is four commits ahead |
| `phase-1/native-checkout-recovery-spike` | `743c0f9e5cd9e7bb3af5aacba7e88146ff7a9f9e` | `phase-1/checkout-reconciliation-operations-spike` is five commits ahead |
| `phase-1/checkout-reconciliation-operations-spike` | `70b54797ca9860b05c0c7e074b2d212febba3841` | `phase-1/payable-native-checkout-spike` is four commits ahead |

**Content deliberately preserved/superseded on verified PR #26 (not in merge ancestry):**

| Branch | Expected SHA | Verification |
| --- | --- | --- |
| `phase-2/catalog-arabic-storefront-readiness` | `21c1d78a75204784cef81117b8bdd7e3e9da2e16` | Both unique documents copied **byte-identically** into `docs/archive/phase2-pr18/`; older phase gate labeled superseded |
| `policy/mvp-first-deferred-tp-20261027` | `b7ab7e67c88af9836bbdbf37b19f29a85ada91d6` | Exact owner-policy section saved in `docs/owner-mvp-first-policy-20261027.md` and implementation plan; policy change is pending incorporation into `main` |
| `integration/mvp-interface-contract-v1-20261027` | `b390cba88378901d3bd7c3266a6fb841bf541cb8` | Schema, tests and handoff copied; standalone workflow deliberately superseded by green consolidated CI |

**Safest ordering:** delete the five child-ancestor refs from oldest to latest **only if their listed later branch still exists**, then the three PR #26 ancestors, then the three archived-content refs. For owner-policy governance, consider retaining its ref until PR #26 is accepted into main even though the exact section is preserved. A checked-out local worktree branch or concurrent agent operation can still make deletion disruptive: verify local worktrees and remote SHA per ref.

**Do not delete now:** active PR branch/head/base refs (`main`, `phase-1/same-order-native-payment-integration-spike`, `phase-1/checkout-payment-integration-preview`, `phase-2/catalog-storefront-mvp`, `phase-2/mvp-variant-selection-slice`, `integration/mvp-consolidated-20261027`, `phase-1/payable-native-checkout-spike`, `integration/mvp-payment-foundation-20261027`, `phase-1/focused-ci-optimization-spike`, `phase-2/arabic-storefront-mvp`), or unique undigested source refs (`phase-1/idempotency-spike`, `phase-1/sprint3-combined-ci`, `phase-1/payment-order-binding-spike`, `phase-1/order-correlation-spike`, `phase-1/oasis-editorial-preview`).

The commit that first archived PR #18/PR #20 and this register passed consolidated run 40507932998; new documentation-only edits should be verified on their own latest CI run.

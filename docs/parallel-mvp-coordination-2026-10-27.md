# Zamzam Store parallel MVP coordination

Updated: 2026-10-27 (Africa/Cairo)

## Fixed baseline and branch policy

- Repository: `mo3az-git/zamzam-store`
- Fixed baseline: `d5a6bdefb3d0d0a15d6e4f52f86b8369e1e962ea` (verified current HEAD of Draft PR #26 before assignments)
- Candidate branch: `integration/mvp-consolidated-coordinated-20261027`, created from the fixed baseline. Do not use it as an agent work branch.
- Every specialist branch below was created from the same baseline. Rebase/port work by reviewed file/commit selection; do not merge whole divergent PRs.
- No force pushes, branch deletion, main merge, TP-01, canonical 59-TP status changes, live commerce mutation, order/payment/COD/shipping activation, or tariff approval.
- Source branches and changes are preserved. Any owner handoff must be recorded here before a second specialist edits a file.

## Workstream ownership (one active editor per owned file set)

| ID | Workstream | Isolated branch | Exclusive ownership | Handoff/dependency |
|---|---|---|---|---|
| A | Guest ownership and authentication security | `codex/coord-guest-ownership-20261027` | `apps/backend/src/api/store/carts/**`, `apps/backend/src/api/middlewares.ts`, `apps/backend/src/api/cart-mutation-guard.ts`, guest ownership model/service/tests under `apps/backend/src/modules/batch-inventory/` | Must provide trusted session/cart proof contract to B and F. B may propose a completion handler contract but may not edit A's route files. |
| B | Cart and checkout orchestration | `codex/coord-cart-checkout-20261027` | `apps/backend/src/workflows/**`, `native-checkout-coordinator.ts`, `payable-checkout-guard.ts`, orchestration-focused tests | Depends on A's identity proof; C's reservation/availability rules; E's quote interface. Route wiring is handed to A after review. |
| C | FEFO inventory and authoritative availability | `codex/coord-fefo-availability-20261027` | `availability.ts`, `store-visibility.ts`, inventory ledger/locking primitives and FEFO-focused tests | Supplies provisional availability DTO and reservation predicates to B/F. No public availability route without A's authorization review. |
| D | COD and electronic-payment foundation | `codex/coord-payment-foundation-20261027` | `apps/backend/src/modules/order-operations/**`, payment event/provider tests and payment-specific workflow files only | Depends on B's immutable completed-order contract. Provider/gateway remains undecided; synthetic/disposable evidence only. |
| E | Provider-neutral shipping | `codex/coord-shipping-contract-20261027` | `egypt-shipping-configuration.ts`, shipping contract/helpers/tests | 27 governorates required. Per-governorate prices vary, but tariff/provider are undecided: keep all unapproved prices unconfigured. Supplies a quote/blocker interface to B/F. |
| F | Bilingual storefront and customer journey | `codex/coord-storefront-journey-20261027` | `apps/storefront/**` | Consumes only A/B/C/E DTOs; no privileged backend imports, client price authority, live order/payment controls, or invented availability/shipping. |
| G | Integration QA and nonproduction infrastructure | `codex/coord-integration-qa-20261027` | `.github/workflows/**`, disposable Compose/runner files, `scripts/browser-qa/**`, integration test orchestration | Can wire commands but cannot edit specialist-owned implementation files. CI must prove tests are disposable and never run TP-01. |

If a requested change crosses ownership, the assigned specialist writes an interface proposal; the owning specialist implements it after explicit handoff. Do not co-edit shared workflow/package files: G owns those. Docs from existing PRs are reviewed by coordinator and ported by the owning workstream or coordinator only.

## Shared interface contracts

| Producer → consumer | Contract | Authority and safety invariant |
|---|---|---|
| A → B/F | Guest cart session resolves opaque HttpOnly secret to exactly one cart; route cart ID is equality check only | Cart ID alone is not guest proof. Invalid, expired, mismatched, locked, or unavailable ownership fails closed. |
| C → B/F | `authority: batch_inventory`; status only `available | unavailable | unknown` | No stock counts; unknown on missing shelf-life policy/location/scope; availability is advisory, checkout reservation is authoritative. |
| B → D | Immutable completed native order snapshot with stable order ID, currency, amount, line/allocation identity, and checkout attempt | Server-derived native order and totals only; no client price/payment/provider authority. |
| E → B/F | 27 allowlisted governorate identifiers, province mapping, and quote state | Ready price requires approved provider and approved EGP rate for selected governorate. Until owner decisions, only pending/unconfigured/blocked responses; no tariff values. |
| A/B/C/D/E → F | Stable DTOs and blocker codes; no internal module imports in browser code | Server-only boundary; localized presentation never grants readiness or mutates commerce. |
| G ← all | Scoped commands, fixtures, expected output, and disposable target profile | Separate focused suites; no TP-01; CI evidence attached to exact candidate SHA. |

Dependency order: A identity proof → C/E contracts and B orchestration in parallel → D payment persistence after B's order snapshot contract → F consumes approved DTOs → G combined integration gate. G's isolated infrastructure checks can proceed continuously.

## Existing PR register and integration queue

All listed PRs are open Drafts. Their heads are retained unchanged. GitHub comparison against the fixed baseline reported divergent histories; review/port only scoped changes and ancestry.

| Queue | PR | Head SHA | Base / merge-base relative to baseline | Changed area | Evidence on PR head | Decision |
|---:|---:|---|---|---|---|---|
| 1 | #19 | `daa877a558d05d2b70beb183a65f14875c9457fa` | Base `phase-1/checkout-payment-integration-preview`; diverged, merge base `b4114926b4c59a2c59db383a299881ceb244f522` | Guest ownership, checkout, payment event ledger, shipping config, API mutation guard | Package/build/migration and COD/electronic disposable CI succeeded | Source record; split selective work across A/B/D/E. Never merge wholesale. |
| 2 | #29 | `61ff9a1e3b521fa1d831e195e06723d150922941` | Base `phase-1/same-order-native-payment-integration-spike`; 2 ahead/7 behind baseline, merge base `90f858e6998288be4b07a8b0e506f1a586896919` | Completion route deny, test, consolidated workflow, storefront/docs inherited in PR file listing | Consolidated integration CI succeeded; Vercel preview comments succeeded | Port only the completion deny/test if absent at baseline and review exact tree diff under A/G; inherited full diff is not a merge plan. |
| 3 | #34 | `088b40ae5ce2573d81d3488c48351ac14d0d6112` | Base consolidated integration; 3 ahead/3 behind, merge base `d62e1dfdb964b84f80da8dbdcb453260e2d79a65` | Locking Redis empty-key hardening and integrity CI/report | Vercel preview only in check-runs; inspect PR body/local evidence and rerun focused disposable suite | Review C/G; require CI before port. |
| 4 | #30 | `9fc07be2c8b0367c732c6d7538a9b6c00e4e9a7d` | Base consolidated integration; 2 ahead/5 behind, merge base `ca6a407629cb09005b53d3203fa6c03618835998` | Ops readiness docs/script, package scripts, consolidated workflow | Consolidated integration CI succeeded | G reviews; docs/script may port after package/workflow diff review. |
| 5 | #31 | `47f75ab8df51be64b48082bdfc1c96441b22543e` | Base consolidated integration; 3 ahead/5 behind, merge base `ca6a407629cb09005b53d3203fa6c03618835998` | Disposable Compose/Windows runner and browser QA | Consolidated CI, Chromium smoke, synthetic guest preview succeeded | G reviews and runs disposable safety checks; browser workflow overlaps #35. |
| 6 | #32 | `e0f1cdfc87febc123cedd0ea33382ef057f7c147` | Base #30; 5 ahead/5 behind baseline, merge base `ca6a407629cb09005b53d3203fa6c03618835998` | Checkout total readiness, shipping quote contract, tests | Vercel only; PR description records focused tests/lint pass and unresolved cart-adapter mock failures | F reviews exact source; rerun reported failures before port. |
| 7 | #35 | `5aca06320e23daf2675e8913a5ed367f94a3e95c` | Base consolidated integration; 19 ahead/4 behind, merge base `69d6f0b8f4795f347c2aa568c49c0c4841e32a14` | Product accessibility/SEO, site origin, browser smoke | Vercel only in check-runs | F/G split review; browser smoke spec overlaps #31; verify production metadata and accessibility tests. |
| 8 | #33 | `5aa60061e218da067b4c5bacb32d55bafe27f015` | Base consolidated integration; 8 ahead/5 behind, merge base `ca6a407629cb09005b53d3203fa6c03618835998` | Release readiness dashboard document | Vercel only in check-runs | Coordinator docs-only port last, after CI/evidence reconciled. |

## Conflict watch

- `.github/workflows/mvp-consolidated.yml` and `package.json`: PR #30 and PR #29; G owns both.
- `.github/workflows/browser-qa.yml` and `scripts/browser-qa/storefront-smoke.spec.mjs`: PR #31 and PR #35; G owns both.
- `apps/backend/src/api/cart-mutation-guard.ts`, guest ownership, service, and shipping configuration: PR #19; A/B/E partition by file ownership.
- Storefront checkout/shipping tests: PR #32 and the baseline storefront; F owns the tree.
- Source branch ancestry is not equivalent to file ownership. Before porting each commit, compare exact parent/tree, inspect only intended changed paths, apply the scoped patch to candidate, run the owning suite, then record resulting candidate SHA and CI.

## Candidate log

| Candidate SHA | Action | Tests/CI | Status |
|---|---|---|---|
| `d5a6bdefb3d0d0a15d6e4f52f86b8369e1e962ea` | Fixed starting point copied from PR #26 | Inherited PR #26 CI evidence to be revalidated after integrated ports | Draft candidate branch created; no PR yet |


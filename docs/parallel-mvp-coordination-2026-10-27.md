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


## Coordination execution log

- Verified PR #26 current HEAD equals fixed baseline `d5a6bdefb3d0d0a15d6e4f52f86b8369e1e962ea`; PR #26 remains open Draft.
- Created isolated agent refs A-G and candidate branch from the fixed baseline. Candidate working head before this log update: `cfd200591f3a4bdaef69434634aebccff1842fa9`.
- The desktop host could not create usable specialist worktrees: the attached checkout has invalid/nonwritable Git metadata and remote refs cannot be fetched into it. Agents therefore use exclusive remote branches through GitHub API; no two agents edit a shared branch or path concurrently.
- Agent B completed a read-only interface review (no changes/tests): authority must be a server-only verified object bound to guest session, persisted cart, current attempt/epoch/lease and active lock; never client JSON. B revalidates on each mutation and before completion. Native snapshot includes order/cart identity, order version, EGP totals, sorted line identity/variant/key/quantity/raw-unit-price; shipping snapshot fields are deferred until E defines persisted quote. Ambiguous correlation remains reconciliation-pending; public payable completion stays disabled.
- Agents A, C and D are active on isolated branches. Initial reviews/tests are scoped and disposable. Branches A/C/D will not overlap by the exclusive matrix above.
- PR #19/#29/#30/#31 have successful relevant GitHub Actions evidence on their respective heads. PR #32-#35 have no full integration workflow evidence in the current check-run set (PR #32 body also records unresolved cart-adapter failures). Re-run on candidate after reviewed ports.


## Specialist outcomes as of 2026-10-27

- A (guest ownership): read-only review only. No API routes currently bind the PR #19 guest-token helper to storefront calls; raw proof must remain HttpOnly/Secure/SameSite cookie, server side only, with only digest persisted. GET and every mutation need cart ownership enforcement. No tests/commit.
- B (cart orchestration): read-only contract review only. Client JSON cannot mint authority; B requires A-minted verified server authority bound to guest session, persisted cart, attempt/epoch/lease and Redis lock; every mutation and completion revalidate. No tests/commit.
- C (FEFO): isolated branch commit `919adaf3cfed5bcb78e54d30ae1881e9d3902360` rejects blank/non-string Redis lock keys and adds mock/disposable Redis tests. No workflow run or local test execution is available, so unverified. Internal availability remains read-only available/unavailable/unknown; reservation remains authoritative.
- D (payment): no isolated baseline patch. PR #19 event ledger/provider contract are absent from baseline and broad/divergent; no transplant. Gateway and provider remain undecided; no tests run.
- E (shipping): no patch. Baseline has 27 canonical governorates; coverage/rates/provider remain unconfigured. Integration fixture synthesizes rates/options only in disposable tests. No approved tariff/provider.
- F (storefront): read-only review. PR #32 shipping adapter should require EGP and selected governorate; baseline currently allows ready quote without either. PR #35 presentation fixes are candidates. No patch/tests. PR #32 reports 37 focused tests/lint passing, but 4 cart-adapter mock failures; PR #35 has Vercel success only, not full CI.
- G (integration QA): read-only review. Candidate workflow is least privilege and disposable-only; candidate has no observed GitHub Actions run yet (Vercel status alone is not combined CI). Port only #29’s completion-deny regression step; do not copy its entire workflow.
- Agent checkout limitation: no usable isolated writable local worktree is available on this host. Specialists use their exclusive remote refs through GitHub APIs. The shared checkout remains untouched.

## Reviewed integration queue (no wholesale merges)

1. Preserve candidate baseline and no-live-commerce posture.
2. B handoff review: consider only PR #29's fixed-404 cart completion guard and its negative test, plus a G-owned workflow step. The route/test add no authorization capability and assert zero service resolution. Wait for B confirmation before editing B-owned paths.
3. C lock-key validation: review commit ancestry and diff, then wire its focused mock/disposable tests under G; do not integrate until CI execution is available.
4. F: selectively port PR #32 shipping quote validation and PR #35 storefront-only a11y/localization improvements; run focused storefront tests and resolve reported cart-adapter failures first.
5. A/B ownership wrapper and guest cart flow must be designed and tested together before enabling mutations.
6. E shipping quote persistence/coverage requires owner decisions and approved tariffs; keep all rates/provider unset.
7. D payment event ledger/provider adapter only after native completion contract is stable; gateway remains undecided.
8. G port isolated disposable integration/browser CI after file ownership coordination; create/update candidate Draft PR only after a reviewed port has candidate CI evidence.

## Current candidate evidence and blockers

- Candidate head before this manifest update: `d056b7c1131cc9d97959102776801ee9e676ce1d`. No candidate GitHub Actions run was observed; Vercel success does not establish tests.
- Combined CI, browser checks on candidate, and end-to-end integration evidence are outstanding.
- P0: no verified guest/cart ownership enforcement through storefront/BFF/API; do not expose cart mutation/completion.
- P0: no verified authoritative completion/payment path; keep live order placement and payment disabled.
- P1: shipping quote missing currency/governorate binding can be treated as ready; integrate reviewed F fix after ownership signoff.
- P1: lock key validation patch has no test evidence on candidate.
- P1: cross-cart IDOR/BOLA, replay/stale-state, rate limiting, sensitive error redaction, and server-only bundle checks still require dedicated negative tests.
- P1: shipping rates/provider and payment gateway are undecided; all 27 governorates remain unconfigured for launch fulfillment.
- P2: storefront accessibility, canonical-origin, bilingual navigation and responsive checks need selective PR #35 integration plus browser validation.


## PR #37 candidate validation update

- Draft integration PR: https://github.com/mo3az-git/zamzam-store/pull/37; base is PR #26 source branch `integration/mvp-consolidated-20261027`, preserving the fixed baseline and source PR.
- Candidate code/workflow SHA `f0cd789b61fe898cfdca258b800dc7ac917286e0` passed GitHub Actions run `40576803126` / job `122445289846` (2026-10-27). Passed steps: storefront unit suite, read-only payable quote, cart mutation boundary, cart completion disabled negative test, guest preflight, governorate/province contract, 27-governorate policy, internal availability, scoped visibility, lint, disposable DB migration, guest ownership integration, PostgreSQL FEFO integration, Medusa visibility integration, backend build, storefront build, and API-boundary schema tests.
- Vercel preview status also succeeded. This is preview status only; GitHub Actions is the combined CI evidence.
- No candidate workflow run or test mutates production orders, captures COD, charges a gateway, configures actual shipping rates, or runs TP-01.
- Current code remains intentionally blocked at guest cart ownership wiring, authoritative checkout readiness/completion, payment-provider selection, and approved shipping tariffs. PR #37 remains Draft.

## Latest integration result (supersedes earlier C and CI status)

- Selectively integrated C's three-file patch from commit `919adaf3cfed5bcb78e54d30ae1881e9d3902360`: lock provider rejects empty, blank, non-string lock keys before Redis; a unit test asserts Redis is not called; the disposable Redis edge suite asserts no empty/global or undefined fallback key is created. Source branch remains preserved.
- G added two CI steps for those focused tests. The first candidate run `40577738520` failed because I placed the new edge assertion inside the shared test helper, causing recursive invocation. The placement was corrected; unit test had passed. This was a test-harness defect, not a lock-provider failure.
- Corrected candidate SHA `de35303a8b25697435e2dbe3c906a5d758ddee8b` passed combined Actions run `40578111428` / job `122449885592` (31 workflow steps successful), including both lock tests, all prior focused/disposable checks, lint, migration, and backend/storefront builds.
- Latest Vercel result is rate-limited (retry in 24 hours), not a build failure. GitHub Actions is the authoritative candidate CI evidence.
- PR #37 remains Draft and stacks on the pinned PR #26 branch. The baseline PR #26 is still Draft at the pinned SHA. No source PR was merged or deleted.
- This is a coordination candidate, not an MVP-ready release. A/B guest ownership and mutation authorization, stable B checkout contract, F quote readiness fix and browser/accessibility validation, D provider/event integration, and owner-approved E tariffs remain queued. No real shipping rate is configured.

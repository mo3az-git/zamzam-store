# MVP wave integration evidence register

Updated: 2026-10-27 (Africa/Cairo)

## Candidate and method

- Candidate baseline: Draft PR #37 head `d967d90f64314c36aa9efb745ee477196ace2a49`.
- Coordinator branch: `integration/mvp-wave-coordinator-20261027`.
- This branch is an isolated, selective integration candidate. No source PR, `main`, or canonical TP record was merged, rebased, deleted, or force-pushed.
- Every admitted change was reviewed against the candidate's exact tree. A source PR's passing status is not treated as candidate evidence.

## Current workstream review

| Workstream | Reviewed source head | Decision | Candidate evidence / dependency |
|---|---|---|---|
| A. Guest ownership lifecycle | #39 `7c4305dd8736ae249219e36c2aa11356cf7c4441` | Admitted as commit `1f4440409e88b1585002b8ccfffca843297cd7e7`. | Native cart reads and mutations require a single valid server-owned guest cookie resolving to the exact routed cart. Missing, stale, malformed, duplicate, unavailable, and cross-session proof fails closed. Completion remains excluded and deny-only. |
| B. Protected Cart BFF | #38 `e9382391830f58cdda82164e19bc810276e7ee1a` | Deferred. | It supplies an unmounted orchestration seam, not an HTTP adapter. Before admission it needs a same-origin route, cookie issuance/reading, CSRF/origin protection for writes, server-side native mutation adapter, durable idempotency adapter, and negative HTTP tests. Its availability interface also must carry trusted aggregate line quantity. |
| C. FEFO availability | #34 `0b48fa40821cc6c369ad12d928946f3195c39c13` | Admitted selectively as `9de92d8339da44e5e82e7f19323d3c60e625fa48`. | Availability now compares trusted aggregate demand with eligible FEFO batch remainder, while returning only `available`, `unavailable`, or `unknown`. The candidate already runs both unit and disposable PostgreSQL availability tests; the source-only standalone workflow/report were intentionally not imported. |
| D. Checkout shipping/payment readiness | #36 `c1942f9925e4080e9a47d95802bbf2bf6949ed52` | Admitted selectively as `fb9adc1`, `0faed58`, `c59e176`, `08dc0e0`, `5a66754`, then CI step `91c2a4b`. | The provider-neutral shipping quote readiness contract is read-only and fails closed. It neither selects a provider nor activates payment, COD, delivery, order creation, or cart completion. Payment gateway readiness remains unresolved. |
| E. Storefront cart integration | #35 `99be5ba5cd4cb97fb69acb77e6a9f2fe0f49fbaa` | Deferred. | Its client expects the missing BFF route from B. Admitting it first would create a browser path with no verified ownership/CSRF transport. |
| F. Combined security and journey QA | #40 `49cf906d8a5765cd266751445cf0880800a09c4e` | Deferred as a wholesale port. | Its workflow removes existing completion-deny and lock regressions, so it is not compatible unchanged. The candidate instead preserves those checks and adds the native ownership route regression. Synthetic browser preview remains non-production-only and cannot prove the missing BFF journey. |

## Candidate contract decisions

1. The browser never receives a cart ID or guest-session secret as authority. The guard accepts only the server-issued cookie and verifies it resolves to the route cart ID.
2. Native `POST /store/carts/:id/complete` remains a generic deny-only 404. No public order completion is exposed.
3. FEFO availability is advisory. A future checkout coordinator must aggregate demand by variant, resolve locations and shelf-life policy on the server, and perform the fenced inventory reservation immediately before any authorized completion.
4. Shipping `ready` requires a trusted native EGP snapshot with a positive rate and a matching approved configuration. Unapproved governorates stay blocked; fixture names and amounts in tests are synthetic only.

## Candidate-local verification before remote CI

On the resulting candidate tree, before the final evidence commit:

- `node --experimental-strip-types --test apps/backend/scripts/test-cart-completion-disabled.test.mjs apps/backend/scripts/test-guest-cart-ownership-route-policy.mjs apps/backend/scripts/test-batch-availability.mjs` — 14 passed, 0 failed.
- `node apps/backend/scripts/check-shipping-quote-readiness-contract.mjs` — 10 passed.
- `git diff --check` — passed after normalizing the admitted FEFO files.

The consolidated GitHub Actions run on the final pushed SHA is required to replace this local evidence. No claim of a remote pass is made by this register before that run completes.

## Release blockers and owner decisions

- P0: B must deliver and test the protected same-origin Cart BFF before storefront cart operations can be exposed.
- P0: Public completion stays disabled. An ownership-aware, reservation-aware checkout workflow with an immutable native-order contract is still absent.
- P0: Select an electronic-payment gateway and its approved production configuration; do not use simulated payment behavior as launch behavior.
- P0: Select a fulfillment provider and approve EGP fees for all 27 governorates. No synthetic rate is a merchant approval.
- P1: Reconcile B's line-demand contract with C's `requestedQuantity` requirement; include stale-version, replay, CSRF, cross-session, and IDOR HTTP journey tests.
- P1: Rework F's combined QA workflow so it retains completion-deny and lock checks, then run it against the exact candidate SHA.

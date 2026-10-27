# Consolidated backend quote and legacy audit — 2026-10-27

All preserved code comes from named existing repository branches; **no external payment gateway, web checkout route, COD remittance or new database write is implemented here**.

## PR #23, selective port (commit `7bf8fecb63ca91a75151de87a6399595e61c7183`)

Ported exactly from PR #23 into PR #26:
- `apps/backend/src/modules/order-operations/payment-quote-validation.ts` — pure, read-only cart/order/version/EGP-major/minor consistency validation, returns a frozen internal quote.
- `apps/backend/src/modules/order-operations/native-payable-quote.ts` — internal read-only bridge to PR #19 native snapshot; **not an authorization to persist payment**, not a store/public route.
- `apps/backend/scripts/test-mvp-payment-quote.mjs` — isolated pure unit tests included in **consolidated targeted CI**.
- `docs/mvp-backend-payment-foundation.md` — historical PR #23 rationale (the referenced PR #16 is no longer the backend source of the integrated app).

**NOT PORTED:** PR #23's older payment models, migration, service and module registration overwrite, because PR #19 is the canonical later implementation including a post-completion finalizer, checkout authority/locks and its own models/migration. PR #23's standalone CI YAML is superseded by the consolidated CI. Do not treat these two payments branches as independent money writers or merge histories wholesale.

**Security boundary:** the quote snapshot can change before a payment transaction. The trusted PR #19 completion finalizer still owns cart-to-order correlation, immutable method, lock, amount and stock checks under the correct transactional authority. These helpers are **not exported through an HTTP route or called as authorization**. Unit tests are not formal TP and do not test live Medusa or gateway charges.

## PR #17, archive instead of importing old CI selector

PR #17 head `5dc42aee05a3f38720322b9c48089bdfd0d621c3` uses an older auto-selector choosing subsets of named TP/technical prototype suites. All five changed PR #17 files are preserved **byte-identically** at `docs/archive/phase1-pr17/`. The archive mirrors source paths including a workflow copy, which is **not executable by GitHub Actions** because it is under `docs/`.

We intentionally **did not enable** its selector: it is keyed to historical Phase 1 test names and could cause missing high-risk coverage as the consolidated MVP integrates new payment/read-only catalog boundaries. Current `.github/workflows/mvp-consolidated.yml` runs an explicit conservative set (install, storefront tests, quote unit tests, lint, disposable DB migration, both builds, JSON Schema validation). This is a development gate, not a substitute for the complete deferred 59 TP suite.

## Orphan Phase 1 idempotency prototype archive

The three original files from `phase-1/idempotency-spike` head `ab2d99086da7b405a58d14db57655c94b38bb5b0` are preserved byte-identically at `docs/archive/phase1-idempotency/`. **This prototype is NOT installed or imported**: it defines separate database lease SQL and replay response semantics that must not override current checkout attempt/lease recovery and immutable completion security. This archive protects historical inspectability before deleting its orphan remote branch. No TP-01 or formal TP status is changed.

## Retiring source PRs

PR #23 and PR #17 may be closed as **superseded, not merged** once the consolidated CI containing the newly ported files succeeds. Their branches can only be deleted after confirming current remote SHA, PR head/base dependency and any agent worktrees; the Codex/GitHub connection available in this conversation cannot delete remote refs.

**Safety:** Do not enable live customer payments, infer checkout authorization from a read-only quote, change the canonical TP registry or execute TP-01. All 59 formal tests remain a future release gate, with TP-01 separately unauthorized.

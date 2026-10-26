# Phase 1 TP Execution Register

**Gate status: OPEN.** The 59 rows in `docs/implementation-plan.md` are specifications, not executed tests. A green CI workflow, the Redis adapter regression checks, and registry-integrity validation do not count as TP acceptance.

## Execution batches

Run only against disposable PostgreSQL and Redis services. Never use production credentials or data.

| Batch | TP scope | Prerequisites / evidence focus |
|---|---|---|
| A — Platform baseline | Check H; TP-01, TP-02a, TP-03 | Medusa API starts; real cart/variant fixtures; Redis owner/TTL evidence; before/after DB snapshots |
| B — Checkout guards | TP-02b, TP-02c, TP-04a, TP-04b, TP-05, TP-12a–TP-12c, TP-14a–TP-14b | Implemented routes/workflows; lease CAS and epoch assertions; explicit COD/electronic branch fixtures |
| C — Inventory ledger | TP-06a, TP-06b, TP-07a, TP-07b, TP-09, TP-10, TP-23e, TP-24a, TP-24c | Migration-backed schema; transaction and concurrency harness; invariant SQL before/after |
| D — Order conversion and recovery | TP-08a, TP-08b, TP-11, TP-13a–TP-13g, TP-15a–TP-15c | Native workflow invocation; deterministic crash injection; correlation and fencing assertions |
| E — Shipping and guest access | TP-16–TP-20b | Implemented fulfillment/claim routes; HTTP assertions plus database/cache checks |
| F — Returns and refunds | TP-21a–TP-21f, TP-22a, TP-22b, TP-23a–TP-23d, TP-23f | Return/refund schema, triggers, service boundaries, dual-control actors, concurrent capacity checks |
| G — Payment and reconciliation | TP-25a–TP-25d, TP-24b | Provider-neutral simulator, signature fixtures, replay/out-of-order delivery, payment/order cross-table audit |

Batch boundaries are sequencing guidance, not claims that their prerequisites currently exist. A case must be marked blocked if its required implementation or fixture does not exist; do not replace the behavioral test with a mock that bypasses the behavior under test.

## Per-case evidence contract

For every TP row (including lettered rows), save a separate `artifacts/tp-evidence/TP-<id>/` directory containing:

1. `result.json`: TP ID, status (`passed`, `failed`, or `blocked`), UTC start/end timestamps, exact commit SHA, Node/npm versions, package-lock SHA-256, database/Redis image versions, test command, process exit code, and failure summary.
2. `stdout.log` and `stderr.log`: raw terminal output; do not paste a manually rewritten summary in place of logs.
3. `db-before.sql` and `db-after.sql` or equivalent machine-readable query results for all relevant rows and invariants. Redact secrets and customer data.
4. `assertions.json`: named assertions, expected values, actual values, and pass/fail for each database, HTTP, Redis, concurrency, or ledger invariant.
5. For race/crash cases, the deterministic interleaving/fault-injection schedule and worker/process outcomes.

A TP is accepted only after an independent review verifies the test exercises the real implementation, the raw logs match the result metadata, the process exit code is zero, every required assertion passes, and the database state matches the expected outcome. `blocked` and `failed` are not acceptance. Missing evidence is not a pass.

## Definition of done for a TP execution

A test procedure (TP) execution is complete and eligible for acceptance review only when all of the following conditions are met:

1. **Green CI:** Continuous integration is green on the commit under review.
2. **Empirical assertion values:** Every assertion's actual and observed values derive from runtime behavior or captured runtime evidence; the expected value may be a documented specification constant (for example epoch = 1); no assertion may pass by comparing constants to themselves or by relying on hand-written evidence that does not reflect actual execution.
3. **Real runtime components:** Real PostgreSQL, real Redis and the real Medusa container loaded from `medusa-config.ts` are used during execution.
4. **Persisted evidence artifact:** The per-case evidence directory (`artifacts/tp-evidence/TP-<id>/`) is uploaded as a CI artifact.
5. **Independent review gate:** No TP checkbox in `docs/implementation-plan.md` is ticked without independent review.

## Backlog (non-blocking findings)

- **Environment-based disposable target limitation:** The disposable-target check is environment-based (`PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES`, `PHASE1_DISPOSABLE_TEST_PROFILE`) and cannot prove the underlying service is disposable. It protects against accidental execution against persistent local or remote environments, but does not provide cryptographic proof of disposability.
- **TP-02a hardening policy:** Further hardening of TP-02a is done only if a finding could make a "passed" result false; such a finding must be fixed immediately, not backlogged.

## Current execution ledger

- TP specifications: 59; implementation-plan statuses remain unchecked.
- Behaviorally accepted: 0. No TP row may be marked passed by the readiness scan.
- Redis adapter regression checks: 12/12 passed on the disposable Redis service; these remain adapter-level evidence and do not substitute for TP cases.
- Medusa CLI loader resolution: confirmed. The current fix pins `tsconfig-paths@4.2.0` as an exact root devDependency in `package.json`, ensuring Medusa CLI 2.22.1 calls to `register({})` resolve `baseUrl` safely without `TypeError`. (Historical note: earlier iterations used a guarded postinstall script `scripts/patch-medusa-cli-tsconfig-paths.cjs` to patch `cli.js` to call `register()` without arguments; that postinstall script and patch have been completely removed and superseded by the exact devDependency pin).
- Clean-install gate: closed and enforced. The repository has a committed `package-lock.json` (SHA-256 `c3de50651eccf1a8c6843b5c0e536de375d05b91a2bf7818fd94fdfa7c6b291f`), and `.github/workflows/phase1-spike.yml` performs a clean `npm ci --strict-peer-deps` without on-the-fly lockfile generation.
- Group A and B–G readiness: CI writes per-case evidence for all 59 rows. If implementation/fixtures are absent, each case is explicitly `blocked` with source inventory and read-only database schema evidence; no behavior is mocked or reported as passed.
- TP-02a (Distributed Cart Lock Acquisition): executed, latest verified CI green on commit `9911351fdbf58a3f8cfba63b867aa1201afced81` (Push run https://github.com/mo3az-git/zamzam-store/actions/runs/40341188882, PR run https://github.com/mo3az-git/zamzam-store/actions/runs/40341197117); these run metadata confirm the test step succeeded, while uploaded artifact `phase1-spike-evidence-23ebcd48587525e10bdb8efd7b2231f8677c2f42` (SHA-256 `9f29d91a26ecb391b1b20fcb9f8246a19580b1329afaaa67bf87a974d07fd002`) still requires independent content review (not accepted). Executed against the REAL Medusa container loaded from medusa-config.ts with real Cart fixture created via Modules.CART, linked cart_checkout_session fixture with integer epoch migration, pre-workflow DB snapshot captured immediately before workflow execution, guaranteed lifecycle cleanup execution (control flow refactored into runTp02aTest with guaranteed finally block and exit code returned after tear-down), strict disposable test target validation without CI hostname bypasses (37/37 self-check unit battery), scoped CI profile requirement (`ci_ephemeral_service`), exact rollback DB UUID pattern validation, fresh post-workflow database queries requiring exactly 1 row for both Cart and checkout session fixtures, and hardened assertions (39/39 assertions: verifying disposable test resources, validator self-checks, real cart creation & DB persistence, provider config, container registration, Redis physical key prefix, in-flight Redis lease TTL & ownership, sub-workflow lock skipping, lock release, before-vs-after database invariance across all 7 session columns [cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at] and Cart fields, and verified fixture cleanup); artifact evidence recorded under `artifacts/tp-evidence/TP-02a/` (39/39 assertions passed) and awaits independent review. Implementation plan checkbox remains strictly unchecked `[ ]`.
- TP-03 (Concurrent Cart Lock Rejection): executed (workflow-level only, partial; HTTP-level 409 is NOT exercised until a real storefront route exists; never described as fully passed or complete), latest verified CI green on commit `9911351fdbf58a3f8cfba63b867aa1201afced81` (Push run https://github.com/mo3az-git/zamzam-store/actions/runs/40341188882, PR run https://github.com/mo3az-git/zamzam-store/actions/runs/40341197117); the runner's workflow-level behavior passed; uploaded artifact `phase1-spike-evidence-23ebcd48587525e10bdb8efd7b2231f8677c2f42` (SHA-256 `9f29d91a26ecb391b1b20fcb9f8246a19580b1329afaaa67bf87a974d07fd002`) still requires independent content review; remains partial and not accepted. Executed against the REAL Medusa container loaded from medusa-config.ts with disposable PostgreSQL and Redis services. Stage 2 lock acquisition retries strictly on genuine lock contention errors (`isLockContentionError`), immediately propagating any non-contention errors as proved by the supplementary negative control battery (`check-stage2-lock-negative-control.mjs`, 3/3 passed). Verified positive control where Worker B acquires free lock via workflow, verifies Redis ownership and TTL in (110, 120], and releases lock cleanly prior to contention. During contention, Worker A acquired lock `cart:<id>` via `Modules.LOCKING` (ttl 120s) and held it throughout the test; Worker B initiated `stage2CheckoutLockWorkflow` on the same cart with `timeout: 5` and blocked under Redis contention for 5.0s ± 0.5s before throwing `MedusaError(MedusaError.Types.CONFLICT, "Cart checkout lock timeout", "LOCK_TIMEOUT")`. Verified out-of-band Redis inspection confirmed Worker A's lock remained intact, un-preempted, and un-overwritten (owner match and positive TTL). Verified PostgreSQL state invariants before and after Worker B failure: `cart_checkout_session` (all columns unaltered: cart_id, current_attempt_id, epoch=1, status='in_progress', timestamps), `cart_batch_reservation` (exactly 0 rows for the cart before and after), and native `reservation_item` count table-wide on the disposable database remained unchanged before and after Worker B rejection (`native_inventory_reservation_item_count_unchanged_before_and_after`). Verified `cart_batch_reservation` physical schema reconciliation against `docs/data-model.md` §3.1. Evidence recorded under `artifacts/tp-evidence/TP-03/` and awaits independent review. Implementation plan checkbox remains strictly unchecked `[ ]`. TP-01 is not executed.
- Migration rollback verification: Migration 3 rollback lifecycle was verified on an isolated disposable database with dynamic `raw_epoch` reconstruction (tested with epoch 1 and 42) and restored check constraints (17/17 assertions passed in `artifacts/migration-rollback-isolated.json`). Database safety is guarded by explicit opt-in (`PHASE1_ALLOW_DISPOSABLE_DB_CREATE_DROP=true`), unique per-run DB names (`zamzam_rollback_<uuid>`), and tracked cleanup. Honest limitation: the test executes compiled MikroORM migration class methods and their generated SQL directly against an isolated PostgreSQL database; it does not test Medusa CLI's batch rollback runner (which operates at batch granularity).
- Store application domain implementation is not present yet beyond the Redis locking adapter, minimal TP-02a cart checkout session and acquire-lock workflow steps, and TP-03 stage 2 concurrent lock workflow with cart_batch_reservation schema. The remaining 57 TP rows need implementation before corresponding behavior can be executed.

## Phase transition

Keep Phase 1 open until all 59 TP rows have reviewed evidence. Do not change any TP status in the implementation plan based on registry checks, build success, adapter-only tests, or assumed behavior. Store feature development remains blocked until the acceptance gate is explicitly reviewed.

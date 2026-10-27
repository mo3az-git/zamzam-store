# Phase 1 inventory ledger implementation

This branch adds a PostgreSQL-backed inventory ledger and pre-order batch reservation primitive for TP-06a and TP-06b, the expired-reservation release boundary for TP-07a, the ledger protection check for TP-24c, and the order-correlated conversion boundary for TP-07b, TP-09 and TP-10. The canonical 59-case registry and all status markers remain unchanged. Runner results are component evidence awaiting independent review; none of the cases is formally accepted.

## Data and transaction rules

Migration `Migration20261026000006_CreateInventoryLedger` creates supplier, inventory location, batch, checkout attempt, and append-only movement tables, and links existing cart reservations to batches. Receipt starts all three balances at zero and records the stock intake movement in the same PostgreSQL transaction. Each committed batch balance is checked against the sum of its movement deltas.

`InventoryLedger.reserveCart` reads actual Medusa carts, line items, and product variants. It requires unique UUID `checkout_line_key` values and `manage_inventory=false`; the minimum shelf life comes from `variant.metadata.packaging.min_shelf_life_days`. FEFO uses the Cairo-local date and the canonical strict expiration comparison. The operation checks Redis cart ownership and the durable PostgreSQL lease, locks checkout authority, locks every candidate batch in ascending ID order, then locks reservation rows. Reservation rows, batch balance changes, and movement snapshots commit or roll back together.

Movement deduplication hashes the version, type, batch, reference type and reference ID; for reservations the reference ID is the persisted reservation ID. Exact retries verify the existing reservation and movement and perform no writes. Reusing an identity with changed quantity returns a conflict. Missing or contradictory balance/ledger state is reported as divergence. A test hook pauses or fails after the real PostgreSQL balance update, inside the transaction, so the test observes rollback of that update and the reservation insert.

`cleanupExpired` shares the pre-order authority and batch-first child-row locking rule. It writes one release movement and expires the reservation atomically. Exact expiry replay is read-only. Order-correlated cleanup takes the order advisory root before checkout and inventory rows; pending conversion is fenced and already-converted rows are skipped. See [the conversion integration contract](phase1-inventory-conversion.md).

## Test boundary

`apps/backend/scripts/test-inventory-ledger.mjs` creates a uniquely named disposable database, applies the real Medusa migrations, starts the real Medusa container and native Product/Cart services, and drops only the database and roles created by that invocation. It uses the pinned local PostgreSQL/Redis services or the disposable CI services and records SQL before/after state, stdout/stderr, assertions, PostgreSQL backend IDs, blocker PID observations, and cleanup outcome. Database create/drop requires the runner's explicit disposable-service opt-in.

TP-06a covers two native cart lines of quantity 2 and 3 against one FEFO-selected lot; it checks distinct reservation IDs and line keys, distinct canonical movements, sequential snapshots, landed-cost snapshots, final available balance, and the strict expiration boundary. TP-06b covers exact read-only replay, changed-quantity conflict, reservation-without-movement divergence, injected failure rollback, concurrent identical intent and a separate-cart capacity race observed through `pg_blocking_pids`. TP-07a covers concurrent expiry cleanup, one release movement, read-only replay, active/released inconsistency, expired/missing movement divergence, and conflicting movement semantics.

TP-24c provisions temporary PostgreSQL roles only in its isolated test database. The Medusa container connects as a non-superuser `medusa_app` role that can read and append movements but cannot update, delete or truncate them. A separate, non-owner login role has UPDATE/DELETE privileges; the immutable row trigger rejects both operations. The test compares the persisted ledger before and after all denied operations. Neither role is created in the shared service database or production.

Run one case from the repository root with:

```powershell
./scripts/run-local-spike.ps1 -PostgresBin ./artifacts/tools/postgresql-runtime/pgsql/bin -SkipInstall -Targeted -Cases TP-06a
```

Use `TP-06b`, `TP-07a`, `TP-07b`, `TP-09`, `TP-10`, or `TP-24c` for the other isolated cases. The default local run includes all existing runners and these seven inventory cases. `-SkipInstall` is recorded and means strict `npm ci` was not repeated in that run.

## Integration contract and limits

The reservation primitive accepts `{ cartId, attemptId, epoch, ownerId }`. The conversion primitive accepts those authority fields plus an already-bound `orderId` and complete `validatedReservationIds`. Checkout remains responsible for acquiring/renewing the idempotency lease and Redis cart lock, creating the authoritative session/attempt, binding the order, and passing the current owner token. The inventory layer does not create or take over checkout leases, renew a lock, create/discover an order, select a payment provider, or reconcile uncertain orders. See [the conversion integration contract](phase1-inventory-conversion.md).

The existing `phase-1/idempotency-spike` lease helper remains a separate checkout concern. Its caller may pass the acquired `lease_owner_id` through this inventory contract after verifying cart/attempt authority; it must not treat lease acquisition alone as permission to create an order. TP-01 remains unauthorized and unexecuted. All four inventory cases still require independent review before formal acceptance, and the Phase 1 gate remains NOT READY.

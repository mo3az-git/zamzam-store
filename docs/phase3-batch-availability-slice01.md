# Phase 3 — Internal FEFO Batch Availability Projection (Slice 01)

**Implemented only in consolidated Draft PR #26**; **NO public Store API route** and **NO customer-facing stock claim**.

## Security and authority
- Source: `batch_inventory.inventory_batch`, with active supplier/location and FEFO expiry checks copied from the existing reservation predicate in `ledger.ts`.
- Eligible stock = `quantity_on_hand - quantity_reserved - quantity_quarantined`; only `available` batches with `expiration_date > Cairo today + variant min shelf-life days` count. This is a non-locking read; it does **not** reserve stock.
- Every requested variant must have an **explicit backend-verified** `minShelfLifeDays` policy (0–365). A missing policy produces `unknown`, not assumed 0 days. Only the backend can establish the authoritative policy.
- Output matches the proposed `contracts/mvp-interface-v1.schema.json` `availabilityResponse`: `{ authority: "batch_inventory", items: [{variantId, status}] }` with statuses `available | unavailable | unknown`. No quantities, locations, batches, expiry dates, supplier or cost details are exposed.
- Backend SQL problems, missing rows, duplicates or corrupt query results produce `unknown`. Read errors do not become `unavailable`.
- Bounded input: up to 100 deduplicated/validated variant IDs; SQL values parameterized.

## Why no public route is enabled yet
Medusa Store requests must resolve a validated publishable-key context with permitted **sales channels**, and product visibility must be checked for the exact variants in that scope before any availability status is returned. A caller supplying arbitrary variant IDs or merely sending a present header is insufficient. The public route and storefront binding are intentionally **deferred until this security predicate is verified on Medusa 2.22.1 in disposable integration tests**. No live inventory was seeded or queried as evidence here.

## Files and tests
- `apps/backend/src/modules/batch-inventory/availability.ts`: internal read-only projection.
- `apps/backend/scripts/test-batch-availability.mjs`: isolated deterministic query adapter tests, including fail-closed behavior, Cairo cut-off and status/shape checks.
- `.github/workflows/mvp-consolidated.yml`: runs unit tests as a **development** guard (not TP).
- No migrations, payments, cart mutations or public API routes changed.

## Follow-up
1. Implement/verify Medusa 2.22.1 store-key sales-channel product visibility for requested variants.
2. Retrieve effective min shelf-life policy from trusted product-variant metadata or explicit configuration.
3. Add disposable PostgreSQL tests for eligible/ineligible batches and concurrency, plus end-to-end Store API visibility tests. Only then enable a scoped GET endpoint returning the strict status contract.
4. Frontend Agent 2 may build a read-only, default-`unknown` presentation component, but MUST NOT show `available` until a verified, authenticated endpoint exists and succeeds.
5. No TP-01 execution, no real checkout, no merge to `main` without explicit owner authorization.

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

## Slice 02 — Medusa Store visibility and location-scope safety (2026-10-27)

The internal projection now REQUIRES an explicit `authorizedLocationIds` array (custom `inventory_location.id` values), which is inserted through a bound `ANY(?::text[])` predicate. Missing, malformed, repeated or empty locations return `unknown` without querying balances; the earlier all-locations view is not a safe authority for a public Store response.

`apps/backend/src/modules/batch-inventory/store-visibility.ts` introduces a pure Medusa Query projection using confirmed graph entity `variant`, fields `product.sales_channels.id`, `product.status`, and product variant `metadata`. Requested variants must belong to a **published** product linked to the trusted sales-channel IDs from `MedusaStoreRequest.publishable_key_context.sales_channel_ids`. This module never trusts channel IDs from query strings or browser request bodies and returns denied (not visible) on errors, duplicates or malformed relations. The FEFO shelf-life threshold is only read from trusted variant `metadata.packaging.min_shelf_life_days` when it is an integer in 0..365; absence stays unknown.

**Important remaining integration:** This change does not claim the custom `inventory_location.id` keys equal Medusa stock-location IDs. Map them to verified sales-channel stock locations, validate that mapping using disposable Medusa fixtures, and only then add a Store route. Both helpers are deliberately unmounted (no public route). The standalone Query tests use a deterministic fake (not proof of a running Medusa graph). No live stock or purchase authority is granted.

The added focused tests verify multi-channel scopes, unpublished/draft products, absent metadata, duplicate rows, invalid inputs, and absence of any stock SQL when the location scope is missing. No TP-01 / formal TP claims or activation.

## Slice 03 — stricter variant eligibility and migration-backed DB tests

The Store visibility preflight now also requires `variant.manage_inventory === false`, matching `ledger.ts` batch-reservation strategy. Published products attached to a key's sales channel are **not sufficient** if a variant is natively Medusa inventory-managed; such a variant returns `visible: false` from the batch projection and is not authorized to receive a batch stock status. The shelf-life metadata accepts both canonical nonnegative integer values and canonical decimal digit strings (matching ledger behavior), conservatively bounded at 365 days for this read display.

The new `apps/backend/scripts/test-batch-availability-postgres.mjs` verifies the real inventory SQL against the Medusa-migrated `supplier`, `inventory_location` and `inventory_batch` PostgreSQL tables on the GitHub Actions ephemeral service. It creates synthetic batches inside a transaction and always rolls back. A fixed loopback DB name, runtime GitHub Actions flag and explicit CI test opt-in are mandatory; real customer data or external hosts are refused. This test is **not** a Medusa HTTP/product-to-sales-channel or warehouse-link integration test, and no TP acceptance is claimed.

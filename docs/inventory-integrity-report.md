# FEFO inventory integrity and concurrency report

## Scope and safety boundary

This work verifies the batch inventory ledger against synthetic fixtures only. It does not set merchant tariffs, delivery promises, carrier selection, public stock behavior, canonical TP acceptance states, or authorize TP-01. No production inventory or database was used. The disposable integration baseline is PR #26 at `ca6a407629cb09005b53d3203fa6c03618835998`.

Synthetic fixtures and any rates or quantities produced by them are test evidence only. They must not be exposed to public checkout or interpreted as approved business configuration.

## Availability authority

The batch ledger is authoritative for FEFO availability; Medusa aggregate stock is not. A batch contributes only when it is available, its supplier and location are active, the location is explicitly authorized for the server-resolved channel/fulfillment context, and its expiry is strictly later than the Cairo business date plus the variant's configured minimum remaining shelf life. Free units are `max(on_hand - reserved - quarantined, 0)`. The internal `readAuthoritativeBatchAvailability` projection compares that eligible remainder with the trusted aggregate demand per variant. It returns only `available`, `unavailable`, or `unknown`, reads no batch quantities or identities, takes no locks, and is deliberately not mounted on a Store API route.

### Checkout coordinator contract

Import the typed internal function and request/response types from `apps/backend/src/modules/batch-inventory/availability.ts`:

```ts
import {
  readAuthoritativeBatchAvailability,
  type AvailabilityRequest,
} from "../modules/batch-inventory/availability"

const requests: AvailabilityRequest[] = cartLinesAggregatedByVariant.map((line) => ({
  variantId: line.variantId, // resolved and visibility-checked by trusted backend code
  requestedQuantity: line.quantity, // positive aggregate demand for this variant
  minShelfLifeDays: line.minShelfLifeDays, // explicit product policy; never default to zero
}))
const result = await readAuthoritativeBatchAvailability(
  container,
  requests,
  serverResolvedInventoryLocationIds
)
```

The caller must aggregate duplicate cart lines per variant, resolve and authorize fulfillment locations from trusted channel/address context, and establish that each variant is visible before calling. `available` means the current eligible batch remainder covers the full requested quantity; `unavailable` means a healthy database snapshot does not cover it; `unknown` means the policy, scope, or read is unusable. The result contains no stock count, batch identity, supplier, expiry, or cost.

This snapshot is advisory and is not a promise or reservation. The checkout coordinator must still use the existing fenced `InventoryLedger` reservation operation as the authority immediately before native order completion; only its transaction can claim capacity. If availability is `unknown`, do not infer zero or fall back to Medusa aggregate stock. Do not add a public route, query inventory from browser code, cache a positive result beyond the request, or expose an endpoint until ownership approves authentication, sales-channel/location mapping, privacy, cache semantics, and response behavior.

## Existing behavior and regression coverage

The existing `test-inventory-ledger.mjs` creates a uniquely named database, applies Medusa migrations, starts a Medusa runtime, and drops the database afterward. It exercises real PostgreSQL transactions and Redis leases. The relevant scenario IDs are run in the new disposable-service workflow; they are not formal TP acceptance and do not change TP statuses.

| Area | Existing behavior / expected failure | Verification source | Limit |
|---|---|---|---|
| FEFO and expiry | Allocate eligible batches by expiry; exclude batches at or before the Cairo cutoff; reject insufficient eligible quantity | `TP-06a`, `TP-06b` real Medusa/PostgreSQL scenarios; PostgreSQL read-only availability projection | Synthetic batch data only |
| Acquire and idempotency | Same request replays without duplicate writes; changed intent or divergent stored state fails | `TP-06a`, `TP-06b` | Requires disposable PostgreSQL and Redis |
| Release and cleanup | Release/expired cleanup is transactional, replay-safe, and bounded to the current checkout authority | `TP-06a`, `TP-06b`, reconciliation scenarios | Full recovery matrix is `TP-08-recovery` |
| Concurrency and oversell | Real competing transactions serialize; a losing reservation cannot take more than remaining batch capacity | `TP-07a`, `TP-07b`, `TP-09` | Requires live CI services to capture blocker PIDs |
| Conversion | Reservation conversion ties allocation and movement to the correlated native order; same-order races result in one committed set | `TP-07b`, `TP-09`, `TP-10` | This tests correlation components, not TP-01 |
| Fencing and stale leases | Epoch, owner, lease, and heartbeat checks reject stale actors; reconciliation covers process interruption and recovery | `TP-08-recovery`, `TP-09`, `TP-10` | Recovery is synthetic and disposable |
| Ledger integrity | Movement rows are immutable to the application role; balance and movement changes share a transaction | `TP-24c`, rollback assertions in `TP-06a`/`TP-06b` | Disposable roles only |
| Redis locks | Multi-key acquisition is atomic; releases verify owner; release-all and expired lease races are covered | Redis lock and edge-case scripts | Redis service required |
| Empty lock input | Empty arrays, empty strings, and whitespace keys now fail before any Redis command | New fast unit and Redis integration regression | Verified locally by the fast unit; Redis integration runs in CI |

## Correctness and failure matrix

| Condition | Required result | Existing or added guard |
|---|---|---|
| No eligible batch / quantity exceeds eligible stock | Reject reservation; no partial reservation or negative availability | Transactional reservation scenarios; oversell races |
| Expired or below-shelf-life batch | Exclude it from allocation | Cairo date-boundary scenarios |
| Exact repeated operation | Return replay result and perform no duplicate balance/movement writes | Idempotency scenarios |
| Reused key with changed intent or corrupted state | Fail closed; do not “repair” silently | Divergence and corruption scenarios |
| Concurrent claims for same remaining units | Serialize; at most one claim consumes capacity | PostgreSQL blocking-pid race scenarios |
| Release/release-all after owner replacement | Do not delete a new owner's lease or release another checkout's reservations | Redis owner-CAS and cleanup fencing scenarios |
| Stale checkout epoch or lease | Reject stale conversion/release; reconcile from durable order correlation | Recovery and stale-owner scenarios |
| Failure during reservation/conversion | Roll back ledger changes; where an external/native order boundary was crossed, use durable reconciliation rather than assuming rollback | Transaction fault injection and SIGKILL boundary scenarios |
| Empty or malformed Redis lock keys | Reject before invoking Redis | Added unit and Redis integration checks |
| Eligible remainder below requested demand | `unavailable`; equality is sufficient, demand above remainder is unavailable | Unit threshold cases and disposable PostgreSQL batch fixture |\n| Missing/invalid availability policy or location scope | `unknown`; never fall back to aggregate stock or zero-valued availability | `test-batch-availability.mjs`, read-only PostgreSQL projection, and scoped store-visibility tests |

## Concrete fix

`SafeRedisLockingProvider.acquire_` previously deduplicated/sorted the supplied keys but did not reject an empty set or blank keys before building a Redis Lua invocation. It now rejects an empty list and any non-string/blank member before calling Redis. This avoids an invalid/unscoped key path. A no-service unit test verifies the rejection occurs before Redis invocation, and the Redis integration edge-case suite verifies no empty or fallback key is created.

## Production decisions still blocked

These checks cannot be completed without owner decisions and therefore remain blocked; test fixtures do not resolve them:

- Approved source and schema for merchant shipping/inventory policy and who owns changes.
- Minimum remaining shelf-life policy by product/category and its business timezone semantics.
- Authoritative fulfillment location selection and mapping from sales channel/address to ledger location.
- Whether storefront availability should expose quantity, a boolean, or only `unknown`/`available`/`unavailable`; endpoint auth, cache lifetime, and privacy.
- Checkout ownership of reservation timing, expiry duration, cancellation/refund/partial fulfillment compensation, and reconciliation operator procedures.
- Production transaction/locking topology, Redis failover semantics, observability/alert thresholds, backup/restore validation, and migration rollout/rollback approval.
- Approved merchant tariffs, carrier, delivery promises, and public shipping activation remain outside this workstream; no synthetic value constitutes approval.

TP-01 remains unauthorized. No canonical TP acceptance state is changed. This report does not claim production shipping or inventory readiness.

## Runtime evidence status

The local environment has no PostgreSQL or Redis service available, so destructive integration cases are guarded from local execution and assigned to GitHub Actions ephemeral services. The original availability job failed before the projection test because `zamzam_consolidation` did not exist (`3D000`). The corrected workflow provisions that test database from the disposable `zamzam_spike` root, then migrates against a distinct target URL. A successful availability matrix job on the current PR SHA is the runtime evidence for the read-only PostgreSQL projection; earlier passing inventory scenarios do not substitute for it.

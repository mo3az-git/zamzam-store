# Phase 1 inventory conversion contract

This branch adds the inventory-side conversion boundary for TP-07b, TP-09 and
TP-10. It consumes an order that another checkout component has already
authoritatively correlated. It does not start checkout, call
`completeCartWorkflow`, discover candidate orders, or resolve uncertain order
creation. TP-01 remains unauthorized; no TP is formally accepted here.

## Caller contract

The caller invokes `InventoryLedger.convertCartReservationsToAllocations` only
after its own order-correlation step has bound one order to the current checkout
attempt. The input is:

```ts
{
  cartId: string,
  attemptId: string,
  epoch: number,
  ownerId: string,
  orderId: string,
  validatedReservationIds: string[]
}
```

`validatedReservationIds` must be the complete persisted reservation set for
that attempt. The converter independently checks the durable attempt binding,
`order_correlation_status = correlated`, Redis cart ownership, the durable
checkout lease, and the authoritative native order/cart association through
Medusa's public `order_cart` graph query. It reloads the native order and its
lines; caller-supplied prices, variants, line IDs, or quantities are not trusted.

Every managed native order line must carry a unique UUID
`checkout_line_key` in line metadata. That key maps the order line to its
reservation rows. Conflicting metadata representations, duplicate/missing keys,
variant mismatch, quantity mismatch, expired or released reservations, and an
incomplete/extra reservation ID set fail closed. Net unit price after line
adjustments is saved as the per-unit monetary snapshot.

## Transaction and result

The database transaction acquires locks in this order: order advisory root;
checkout session and attempt; all referenced batch rows in ascending ID order;
all reservation rows in ascending ID order. It then validates the exact set and
ledger sums before inserting allocations and zero-delta
`allocation_conversion` movements, changing reservations to `converted`, and
moving the attempt/session to `allocated`/`completed`. These changes commit
together. An exact replay of the same order/version and reservation set is
read-only; a changed set or divergent allocation/movement snapshot conflicts.

The result contains `orderVersion`, `replayed`, the created or verified
allocation snapshots, and their associated movement snapshots. The allocation
table stores order ID/version, native line item ID, checkout line key, batch ID,
quantity, paid unit amount after discounts, status, and allocation time. Its
unique key is order/version/native line/batch; movement rows are immutable.

Expected conflict codes include `ORDER_NOT_AUTHORITATIVELY_BOUND`,
`ORDER_CART_CORRELATION_NOT_AUTHORITATIVE`, `INCOMPLETE_VALIDATED_RESERVATION_SET`,
`AMBIGUOUS_LINE_MAPPING`, `UNMAPPED_OR_AMBIGUOUS_LINE_ITEM`,
`ORDER_LINE_VARIANT_MISMATCH`, `ORDER_LINE_QUANTITY_MISMATCH`,
`RESERVATION_EXPIRED`, `RESERVATION_NOT_ACTIVE`, and
`AUTHORITATIVE_ORDER_CHANGED_DURING_CONVERSION`. Callers should retain the
checkout fence and surface/reconcile conflicts; they must not release stock as a
fallback when order correlation is unresolved.

`cleanupExpired` follows the same order-rooted hierarchy when an order is
bound. Pending or uncertain correlation is fenced. If conversion commits
first, cleanup waits and then safely skips already-converted reservations. If
cleanup obtains the order root first, it returns `ORDER_CONVERSION_PENDING`
while order conversion is pending; it never releases that stock.

## Evidence boundary

The real PostgreSQL/Medusa runner exposes TP-07b for two-party cleanup and
conversion schedules, TP-09 for deterministic line mapping and negative input
sets, and TP-10 for split-batch allocation and transaction rollback. The
runner uses only disposable local/CI services and does not invoke TP-01. Results
remain component evidence pending independent review; the canonical plan's
acceptance markers are not changed by this implementation.

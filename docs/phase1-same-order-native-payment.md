# Same-order checkout and payment boundary

This internal spike composes the real payable Medusa checkout with the existing
COD and electronic branch persistence. The fixture uses Medusa's local system
provider and a simulated electronic branch; it does not charge a gateway or
establish settlement.

`completeAndFinalizeSameOrder` accepts a dedicated PostgreSQL client, a
Medusa container, server-derived checkout authority and trusted repository
dependencies. Before native completion, `completePayableReservedCart`
checks Redis ownership, the current attempt and a fresh pending lease, then
compares the cart, payment collection and single processable session amounts
as exact EGP minor-unit strings. It repeats this check immediately before the
native workflow. All cart writers must honor the cart lock; otherwise a writer
could still mutate a cart between validation and Medusa's own snapshot.

After conversion, the checkout coordinator records the native order ID,
version, currency, exact minor-unit total, allocation IDs and movement IDs in
the completed idempotency response. The migration protects completed checkout
identity, owner and response against update or deletion. A completed record
from before this migration that lacks the amount is not eligible for this
protocol and requires investigation or a separately designed backfill.

The finalizer acquires the Revision 18 order advisory root first, reads the
native order via `readNativePayableOrderSnapshotInTransaction`, then locks
checkout authority, batches and reservation children. It validates the
completed response against the current native cart/order association, version,
exact total, native payment session, reservation, allocation and movement
sets. It checks the original owner and Redis cart lock, and persists exactly
one branch using the existing `initializePaymentBranch` transaction.
The original pending-lease bridge is unchanged and still rejects expired
pending leases. No caller-provided completed flag grants access.

If the process fails after checkout but before payment persistence, retry the
same entry point with the same server-owned authority and claim identity. It
derives the order and expected amount from the protected completion response;
the branch operation is idempotent. If allocation committed before the response
was stored, retry uses the reconciliation-only coordinator and requires the
original pending lease to remain fresh. Unknown native outcomes stay fenced.

Production requires authenticated server-side composition, real provider
integration, an ownership/lease recovery policy, audit and monitoring, a
retention policy compatible with the new immutable checkout records, and a
policy for older completed responses and non-divisible discounts. Native order
writers and cart writers must respect the same lock contracts. The test
provider's authorization is not proof of a real charge or payment settlement.

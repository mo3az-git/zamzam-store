# Internal checkout reconciliation

`CheckoutReconciliationOperations` is a trusted server-side service. It does
not register an HTTP route. Its composition root must provide a real operator
authorization function, backed by the deployment's authentication and audit
policy. A permissive authorizer belongs only in disposable tests.

`inspect({cartId, attemptId})` returns an advisory snapshot: current attempt
and epoch, a one-way owner fingerprint and lease freshness, idempotency key and
status, native order/cart links, reservation and allocation records, movement
records, and an allowlisted completion response. It does not return the Redis
owner token, request payload, claim hashes, or unrestricted response fields.
Snapshots can change concurrently; only the locked recovery path authorizes a
mutation.

`recover(authority)` requires a trusted server-derived cart ID, attempt ID,
epoch and owner. It checks operator authorization and inspection, then calls the
existing coordinator in reconciliation-only mode. The fence transaction itself
rejects an attempt that has not already started order creation. The coordinator
rechecks Redis ownership, the durable lease and attempt under the established
order-root-first locks and validates the complete reservation set.

| Decision | Reason | Action |
| --- | --- | --- |
| ready | ONE_NATIVE_ORDER_RECOVERABLE | Recover the single linked order and convert the validated reservations. |
| ready | ALLOCATION_COMMITTED_RESPONSE_PENDING | Validate the allocation replay and persist the original response with a current lease. |
| completed | EXACT_REPLAY_AVAILABLE / EXACT_REPLAY | Validate and return the existing result without another allocation or response write. |
| unresolved | NO_NATIVE_ORDER_AFTER_FENCE | Keep the fence and reservations; investigate the native workflow outcome. |
| ambiguous | MULTIPLE_NATIVE_ORDERS | Preserve state and investigate all native links; no automatic selection. |
| blocked | LEASE_EXPIRED_OR_INVALID, LEASE_OWNER_MISMATCH, CART_LOCK_NOT_OWNED or STALE_CHECKOUT_AUTHORITY | Restore lawful authority using the owning checkout policy before retrying. This service cannot acquire or transfer a lease. |
| blocked | CORRELATION_STATE_DIVERGENCE, BOUND_ORDER_LINK_DIVERGENCE, RESERVATION_* or ALLOCATION_SET_DIVERGENCE | Investigate the reported invariant; no force resolution is offered. |
| blocked | AMBIGUOUS_LINE_MAPPING, UNMAPPED_OR_AMBIGUOUS_LINE_ITEM, ORDER_LINE_VARIANT_MISMATCH or ORDER_LINE_QUANTITY_MISMATCH | Investigate native lines and reservations before recovery. |
| blocked | RECONCILIATION_FENCE_REQUIRED or RECOVERY_FAILED | Do not use this path for a fresh checkout; investigate an unclassified failure through protected server logs. |

The payment coordinator must keep the same lawful owner, Redis cart lock and
fresh durable lease through correlation and response persistence. It must treat
an unresolved result as fenced and must not request another native order.
Reacquisition, operator identity, authorization, audit logging, alerting and
manual resolution policy require deployment integration before production use.
The service does not modify payment records, advance epochs, release stock or
rewrite native orders.

# Native payable checkout boundary

The existing zero-value fixture uses non-shipping lines because it has no
shipping method; Medusa requires a suitable shipping method for physical lines.
Its zero total can complete without a payment session, whereas a positive total
requires a processable session. The payable fixture uses a
disposable Egypt region, a non-shipping test item, and Medusa's built-in
`pp_system_default` provider. It creates a payment collection and session
through Medusa workflows, then calls the real `completeCartWorkflow`. The
provider simulates authorization locally and makes no gateway request. It is
not a production payment method or evidence that funds were received.

## Payment coordinator contract

`readNativePayableOrderSnapshot(container, { cartId, orderId,
expectedVersion?, expectedTotalMinor? })` is a trusted server-side, read-only
function. It takes the Revision 18 order advisory root, verifies the unique
native cart/order link, reads the native order twice and returns:

- `orderId`, `cartId`, `currency: "egp"`, and `orderVersion`;
- `totalMajor` and `totalMinor` as exact decimal strings;
- each line's native `lineId`, `variantId`, `checkoutLineKey`, quantity
  and `rawUnitPriceMajor`.

Medusa v2 stores monetary values in **major** currency units; for example
`raw_total.value = "61.7"` means EGP 61.70, or 6,170 piastres. See the
[Medusa v2 monetary model](https://docs.medusajs.com/learn/introduction/from-v1-to-v2)
and [big number documentation](https://docs.medusajs.com/learn/fundamentals/data-models/big-numbers).
The function reads the raw decimal string, uses integer arithmetic, rejects
zero and nonzero digits beyond two decimal places, and never converts a money
value through JavaScript floating-point rounding. Trailing zero precision is
accepted. A mismatch in the expected minor amount or version is an error.
The reservation converter checks the raw EGP order total under the order root,
then reads raw native unit prices and adjustment amounts. It rejects nonzero
sub-piastre precision rather than silently rounding it, while still permitting
the existing zero-total checkout. If an exact decimal value is unavailable it
fails closed. The existing
per-unit allocation policy for discounts that do not divide evenly still needs
an explicit product/accounting decision before production use.

The returned snapshot is valid at the time of the read, not a durable lock
held by the caller. The payment coordinator must reacquire the same order root
and compare the native identity, version and exact total when committing its
own state; all order writers must respect that locking contract. Native
`completeCartWorkflow` validates a processable payment session but does not
enforce equality between the session amount and a changed cart total. A
production boundary must prevent cart mutation during checkout and verify or
refresh the payment collection amount before completion.

The native order completion, inventory conversion, the other agent's payment
intent persistence, and real gateway settlement are separate outcomes. This
spike tests the first two only and does not establish payment intent persistence
or real settlement. Authentication, actual shipping for physical products,
currency policy, payment provider configuration, reconciliation and deployment
integration remain production work.

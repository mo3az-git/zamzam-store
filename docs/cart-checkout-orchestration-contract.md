# Cart BFF and storefront contract

## Status

The guest cart lifecycle is mounted at `POST /store/cart-bff`. It is a server-side Medusa boundary backed by Agent A's `zamzam_guest_cart` HttpOnly ownership proof. The contract intentionally contains no order-completion, payment-execution, shipping-rate selection, or inventory-reservation operation. The existing `/store/carts/:id/complete` route remains default-deny.

This contract is for the storefront integration. The legacy `apps/storefront/lib/cart.ts` native cart-ID adapter must not be exposed as the guest cart API.

## Transport security

- Send `Content-Type: application/json`, `X-Zamzam-Cart-CSRF: 1`, and a browser `Origin` exactly matching an origin configured in backend `STORE_CORS`.
- The server sets `zamzam_guest_cart` as `HttpOnly; SameSite=Lax; Path=/store`; production responses also set `Secure`. Do not read, copy, or serialize the cookie in client JavaScript.
- Do not send a cart ID, owner ID, session secret, price, currency, shipping amount, stock amount, or payment state. Unknown request fields are rejected.
- A missing/expired/revoked/cross-session cookie and an unknown cart produce the same unavailable response. The owner is resolved through Agent A's `resolveGuestCartOwnership`; no second ownership table or resolver exists.

## Request operations

Every request is a `POST /store/cart-bff` JSON body. `requestId` must be a unique 16–128 character token. Mutations and checkout preflight require the last server-returned `expectedVersion`.

| `operation` | Additional fields | Behavior |
|---|---|---|
| `create` | none | Creates a native cart in the configured, verified Egypt/EGP region and sets the ownership cookie. No cart ID or session secret is returned. Treat an ambiguous create timeout as non-retryable; no owner exists yet to scope a retry key. |
| `read` | none | Reads the cart resolved from the cookie. |
| `add_item` | `expectedVersion`, `variantId`, `quantity` | Adds a Medusa variant through the native pricing workflow. |
| `update_item` | `expectedVersion`, `lineItemId`, `quantity` | Updates quantity; no price field is accepted. |
| `remove_item` | `expectedVersion`, `lineItemId` | Removes a line through Medusa's native line-item workflow. |
| `set_delivery` | `expectedVersion`, `delivery` | Updates allowlisted guest/address fields. `governorateId` must be a canonical configured governorate ID; notes are stored only as address metadata. |
| `checkout_preflight` | `expectedVersion`, `paymentMethod` (`cod` or `electronic`) | Read-only readiness. It does not create a payment session, quote, reservation, or order. Current unapproved shipping and payment capabilities remain blockers. |

Example add request:

```json
{
  "operation": "add_item",
  "requestId": "a-unique-request-id-0001",
  "expectedVersion": "v1",
  "variantId": "variant_from_catalog",
  "quantity": 2
}
```

## Response and authority

Successful responses contain `ok`, `operation`, `cart`, `blockers`, and `checkout`. The cart includes the opaque server version, lower-case `egp` currency, lines, native subtotal/total, nullable native shipping, and allowlisted delivery fields. EGP decimal values are normalized from Medusa's raw amounts without floating-point arithmetic. The storefront must render these returned amounts; it must not compute a payable total or reuse stale catalog prices as cart authority.

`availability: "unknown"` means the public cart has no approved customer availability endpoint. It must not be rendered as in-stock. Shipping remains null until a native quote exists. `checkout.status: "ready_for_review"` is a readiness observation only; the current adapters keep payment readiness disabled.

Status mapping: invalid body `400`; stale version, locked/completed cart, or idempotency conflict `409`; owner/cart unavailable `404`; durable journal or upstream unavailable `503`.

## Version, locking, and retries

- Cart versions are monotonic values stored in `cart_bff_state`, reconciled against a fingerprint of the native Medusa cart.
- Each native write workflow receives a server-HMAC-signed internal permit. Medusa's own `cart:<id>` Redis lock is acquired first; the workflow validation hook then checks the owner mapping and expected version before advancing the version. Client-provided `additional_data` cannot create a valid permit.
- Mutation idempotency is durable and scoped by the SHA-256 owner key plus `requestId`. An identical replay returns the saved response; a changed body conflicts; an unfinished/failed journal entry blocks replay after an ambiguous outcome.
- `create` is deliberately single-shot because there is no existing owner key before session issuance. The storefront must not automatically retry a timed-out create.

## Coverage and remaining dependencies

The disposable integration covers native create/read/add/update/remove/address/preflight, authoritative Medusa price projection, cookie ownership, cross-cart rejection, stale versions, replay, idempotency conflict, origin rejection, missing shipping/payment blockers, and the default-deny completion route. Availability remains unknown; no live rate, payment, inventory reservation, or order behavior is enabled.

The storefront agent should wire its cart UI to this endpoint and send the CSRF header. Shipping provider/tariffs, customer availability/reservation, and payment method activation remain independent backend contracts and are intentionally not fabricated here.

No TP-01 or canonical TP state changes are authorized by this work.

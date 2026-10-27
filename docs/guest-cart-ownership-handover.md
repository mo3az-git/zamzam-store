# Internal guest cart ownership handover

## Current contract

`createGuestCartWithOwnership` is an internal-only helper. It creates the cart through Medusa's native `createCartWorkflow`, accepts region and optional sales-channel context, and does not accept a cart ID or customer ID. It creates a 256-bit random opaque session secret, stores only its SHA-256 digest with the resulting cart ID, and expires the record after 24 hours. A cart can be bound only once. Do not expose it as an API that accepts browser-selected cart IDs. If persistence fails after native cart creation, the helper returns no secret and the resulting cart is unowned; apply a cleanup policy for such orphan carts.

The trusted storefront server reads the session secret from a protected cookie and calls `resolveGuestCartOwnership(container, secret[, expectedCartId])`. Prefer omitting `expectedCartId` and use the resolved `cartId` to retrieve the Medusa cart snapshot. If an expected ID is supplied, it is only compared to the database binding; it never selects a cart. The returned `owned` object is process-local proof, not JSON. Pass that exact object and the matching trusted Medusa cart snapshot to `evaluateGuestCheckoutPreflight` in the same server process.

Resolver outcomes are `owned`, `not_owned`, `expired`, and `unavailable`. Invalid/unknown secrets and revoked/completed carts return `not_owned`; expired records return `expired`; database, Medusa Cart service, and Redis failures return `unavailable`. All non-owned outcomes keep preflight blocked. Active native cart mutation locks also return `unavailable`. Completed checkout state invalidates the ownership record. The resolver never returns the secret or cart metadata in its result.

## Future browser/server integration requirements

- The browser must not choose a cart ID as identity. The server creates a native cart, issues ownership, and sets the opaque secret in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to the storefront integration path. Never put the secret in URLs, JavaScript storage, or logs.
- Cookie issuance and session resolution need same-origin/BFF routing or a narrowly configured credentialed CORS policy. Cookie-authenticated mutations need CSRF defenses (same-site checks plus a per-request CSRF token/header) and strict `Origin` validation.
- Rotate/revoke the cookie on logout, cart replacement, suspected compromise, and completed checkout. Expired guests should receive a new server-created cart; do not recover an expired mapping using a cart ID.
- Keep `STORE_CORS` restricted to intended storefront origins. Do not treat `x-publishable-api-key` as identity; Medusa uses it for sales-channel scope.
- PostgreSQL migration `20261027000008` must be applied before enabling any caller. Keep expired/revoked rows for the chosen retention window, then add a safe cleanup policy. Back up and restrict access to the ownership table; it contains cart associations even though it stores only token hashes.
- Redis remains required for Medusa's cart lock provider. Resolver checks the existing lock key and fails closed on Redis errors; it creates no parallel locking mechanism.
- The adapter must still enforce existing cart mutation guards, checkout-session restrictions, Egypt/EGP readiness, native shipping pricing, and authoritative Medusa totals. A `ready_for_review` result is never order/payment authorization.

## Not provided by this slice

No Store API route, cookie middleware, CSRF flow, session renewal, checkout authorization, order creation, payment, or inventory reservation is added. The anonymous ownership table is necessary because Medusa 2.22.1's native Store cart routes do not authenticate anonymous cart access; customer authentication applies only when associating a cart with an authenticated customer.

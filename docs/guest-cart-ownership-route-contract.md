# Guest Cart Ownership Route Contract

**Security workstream baseline:** Security PR #29 head `61ff9a1e3b521fa1d831e195e06723d150922941`; Integration PR #26 was reviewed at `ca6a407629cb09005b53d3203fa6c03618835998`. This contract changes no canonical TP status and does not authorize TP-01.

## Current enforcement

- The trusted cart issuer creates a native guest cart and calls `createGuestCartWithOwnership` in the same server flow.
- It sets the returned random 256-bit secret only as the `zamzam_guest_cart` **HttpOnly**, **Secure**, first-party cookie. The database stores only its SHA-256 digest and expiry.
- Native Store `GET /store/carts/:id` and every native cart mutation under `/store/carts/:id/**` now require that cookie. The middleware resolves the secret server-side and compares the resolved cart ID to `:id`.
- Missing, malformed, duplicate, stale, revoked, cross-session, unavailable, or otherwise non-exact proof returns the same fixed unauthorized response. The response must not reveal whether a cart ID exists.
- `POST /store/carts/:id/complete` remains the Checkout-owned default-deny route from Security PR #29. This workstream neither enables nor replaces it.

## Cart/Checkout handoff requirements

1. **Cart issuer:** implement the only public/session-issuing BFF route later. It must choose region and sales channel on the server, call `createGuestCartWithOwnership`, set the cookie with `HttpOnly; Secure; SameSite=Lax` (or a separately approved stricter policy), and return no raw session secret or client-selected cart ID.
2. **BFF transport:** enforce an approved origin/CSRF policy before forwarding cookie-authenticated mutations. The ownership cookie alone is not permission to expose cross-origin browser writes.
3. **Native mutation routes:** preserve `guestCartOwnershipGuard` before `cartMutationGuard`; the latter controls checkout state and locking but does not authenticate a guest.
4. **Checkout agent:** preserve the default-deny `/complete` override. Before any future enablement, compose guest ownership, origin/CSRF verification, idempotency, native totals/shipping, inventory reservation, and the approved checkout workflow in one reviewed server boundary.
5. **Prototype checkout-lock route:** remains disabled and is excluded from this matcher. Its owner must require the same resolved ownership proof before any enablement.

## Required focused evidence before public transport

- Guest A may read/mutate cart A only; knowing cart B's ID never authorizes access.
- Missing, invalid, duplicate, expired, revoked, locked, and persistence/Redis-failure secrets fail closed.
- The browser cannot read the HttpOnly cookie or select a cart ID as authority.
- Cross-origin/CSRF mutation attempts are rejected by the future BFF, separately from the native ownership middleware.
- Cart completion remains 404 until Checkout receives explicit authorization and its own reviewed integration evidence.

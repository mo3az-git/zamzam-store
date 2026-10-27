# Guest cart session transport handoff

## Security boundary

`issueGuestCartSession` is an internal server helper for the Cart BFF's `create` operation. It accepts no request body, cart ID, owner ID, price, or region from the browser. Its caller must resolve the Egypt/EGP region and optional sales channel from server configuration. The helper creates a native cart through `createGuestCartWithOwnership`, resolves the exact ownership proof, and returns only server-side cart context. The raw proof is placed in a cookie and is never part of the JSON contract.

The ownership secret is 32 cryptographically random bytes encoded as base64url. PostgreSQL persists only its SHA-256 digest in `guest_cart_ownership.session_hash`, uniquely bound to one cart and expiring after 24 hours. The browser cookie is:

```text
zamzam_guest_cart=<opaque proof>; Path=/api/cart; Max-Age=<remaining lifetime>; Expires=<ownership expiry>; HttpOnly; Secure; SameSite=Lax
```

The cookie has no `Domain` attribute and is scoped to the same-origin Cart BFF path. Responses carrying or clearing it are `Cache-Control: no-store`. Only a trusted same-origin server handler may call the issuer; do not expose a Medusa route that accepts caller-selected identity.

## Same-origin and CSRF gate

Before any cookie-authenticated `POST`, `PUT`, `PATCH`, or `DELETE`, the `guestCartRequestSecurityGuard` requires all of:

- A configured canonical `ZAMZAM_STOREFRONT_ORIGIN` such as `https://store.example` (origin only; no path).
- One exact `Origin` header equal to that value.
- `Sec-Fetch-Site: same-origin`.
- `Content-Type: application/json` (parameters such as `charset=utf-8` are accepted).

Missing, duplicated, malformed, `null`, cross-origin, cross-site, and simple-form requests fail with the same generic 403. The guard is registered before guest ownership and native cart mutation guards. Do not add wildcard or credentialed cross-origin CORS as a fallback. Route the browser through a same-origin `/api/cart` proxy and forward the original request metadata.

## Retry, expiration, and revocation

- If a valid ownership cookie accompanies a repeated `create`, the issuer resolves and reuses that exact cart; it does not create a second cart or rotate the proof.
- A malformed or duplicate cookie fails closed and is cleared. Expired, revoked, locked, or unavailable proof is not recovered using a cart ID and is not silently replaced during that request.
- Creation has no owner-scoped idempotency key before the proof exists. Do not automatically retry an ambiguous create without a cookie. If the browser received the cookie but lost the response, a retry reuses the owned cart. If neither arrived, return an unavailable state and let the ownership retention/cleanup process remove the unclaimed cart and digest row.
- Cookie write failure revokes the newly persisted proof before returning a generic error. The native cart remains unowned until safe cleanup.
- `revokeGuestCartSession` requires the same Origin/Fetch Metadata gate, invalidates the digest mapping, and then clears the cookie with identical path/security attributes. Failed persistence does not report successful revocation.
- For add/update/remove, use Cart BFF's owner-scoped durable idempotency journal and expected-version checks. Never automatically replay an ambiguous mutation without that server-side journal.

## Cart BFF integration contract

1. Use the existing `cart-bff-contract.ts` request validator. The browser sends intent and a request ID only; it never sends a cart ID or ownership proof.
2. On `create`, call the trusted issuer with server-resolved region/channel context. The returned cart ID/proof is internal server context only. Construct the public snapshot separately and pass the response through `validateCartBffResponse` before JSON serialization.
3. On later operations, parse exactly one `zamzam_guest_cart` cookie and call `resolveGuestCartOwnership`. Use its resolved cart ID and exact in-memory proof; ignore/reject any caller-supplied cart identity.
4. Keep `/store/carts/:id/complete` default-deny. The prototype `/checkout-lock` route remains disabled and is not checkout authorization.
5. The BFF route is still unmounted by this security work. Route mounting, public catalog/cart feature flags, order placement, shipping, COD, and payment remain separate approvals.

## Tests and integration evidence

- `node --test apps/backend/scripts/test-guest-cart-session-transport.mjs` covers same-origin/CSRF rejection, cookie attributes and replacement, one-time creation, valid-session reuse on retry, duplicate/expired proofs, and revocation after cookie-write failure.
- `apps/backend/scripts/test-guest-cart-ownership-integration.mjs` is the disposable Medusa 2.22.1/PostgreSQL/Redis suite for 256-bit entropy, digest-only persistence, unique cart binding, guessed/stolen IDs, cross-cart use, expiry, revocation, completed carts, Redis/PostgreSQL failure, and EGP context. Run it only after its disposable-target validator approves both service URLs.
- Existing PR #39 route-policy tests cover duplicate/malformed cookies and exact cart-path matching. Keep those tests in the combined security CI run.


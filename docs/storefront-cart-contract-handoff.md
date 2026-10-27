# Storefront cart and checkout handoff

## Scope and current state

The bilingual storefront client implements the Agent 2 `cart-bff-contract.ts` wire envelope and allowlists its request operations, response fields, money format, and blocker codes. It posts intent to the same-origin `/api/cart` endpoint with `credentials: same-origin` and `cache: no-store`. It never accepts or sends a cart ID, owner key, price, currency override, stock count, or order-completion operation. The guest session is expected to be an HttpOnly cookie issued by the trusted server adapter. Keep the storefront wire allowlist synchronized with Agent 2's contract until the shared contract is published as a workspace dependency.

The BFF HTTP route is not mounted in this repository state. All product and cart mutation controls therefore remain disabled by default; the server-side `ZAMZAM_CART_BFF_ENABLED` setting defaults to off and must not be enabled until the protected route is mounted and reviewed. A missing endpoint, non-success response, malformed response, or unknown blocker is reported as unavailable; the storefront does not fall back to direct Medusa calls, local storage, synthetic cart data, or a successful mutation message. The endpoint must remain unmounted in production until its ownership, cookie, CSRF/origin, rate-limit, and server-side authorization implementation is reviewed.

## Wire operations consumed by the storefront

| Operation | Client fields | Expected authoritative result |
| --- | --- | --- |
| `read` | `requestId` | Owned cart snapshot, or an explicit unavailable blocker |
| `create` | `requestId` | New owned EGP cart snapshot and server-issued guest cookie |
| `add_item` | `requestId`, `expectedVersion`, `variantId`, `quantity` | Updated server snapshot |
| `update_item` | `requestId`, `expectedVersion`, `lineItemId`, `quantity` | Updated server snapshot |
| `remove_item` | `requestId`, `expectedVersion`, `lineItemId` | Updated server snapshot |

All mutation request IDs are single-use and are not automatically retried. A subsequent `read` is the recovery path after an ambiguous result. Totals, unit amounts, line amounts, currency, and availability are taken only from a response that passes the shared Agent 2 validator. EGP strings are formatted for display; the storefront performs no cart arithmetic.

Session/cart expiry maps to a localized unavailable state; stale versions show the refreshed server snapshot and ask the customer to review quantities; inventory rejection is shown as insufficient stock. Unknown failures remain unavailable and no mutation is retried automatically.

## Readiness and customer copy

- The 27 governorates and canonical province mapping stay as defined by the shared storefront/backend geography contract.
- Shipping remains unavailable until the server returns a valid quote bound to the selected governorate and EGP. Missing or invalid amounts are never rendered as zero or free shipping.
- The current cart response provides only `available`, `unavailable`, or `unknown`. It does not expose FEFO allocation, lot, expiry, or shelf-life evidence. The UI therefore displays only those server-owned availability states. Do not claim FEFO selection or a shelf-life guarantee until Agent 3 provides an explicit customer-safe field.
- Provider/operator and actual governorate-specific EGP tariffs remain owner decisions. Synthetic rates are integration-test-only and must never enter storefront responses.
- COD and electronic-payment radio options are presented disabled. No payment session, order, or checkout request is issued; the checkout submit control remains disabled outside the server-verified QA simulation.

## Activation checklist after approval

1. Record the selected fulfillment operator and the approved tariff for every covered governorate, including currency, effective date, tax treatment, and quote validity rules.
2. Have Agent 2 mount the authenticated same-origin BFF route with guest-cookie ownership resolution, CSRF/origin protection, request idempotency, version checks, strict request/response validation, and no order-completion operation.
3. Have Agent 3 define and return customer-safe FEFO availability evidence; keep unknown data unknown and avoid exposing internal lot identifiers.
4. Have the shipping owner connect native governorate matching and server-owned shipping readiness. Return explicit EGP plus the canonical governorate ID; never supply a default/zero quote.
5. Obtain separate approval for COD and electronic methods, then implement payment readiness and checkout completion behind a server-side production gate. This storefront PR does not activate either.
6. Run the isolated browser and integration suite against the mounted disposable contract before considering a production configuration. Keep all synthetic fixtures and rates isolated from public storefront deployments.

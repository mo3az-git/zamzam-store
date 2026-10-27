# Storefront and API security review

Reviewed source: integration candidate `90f858e6998288be4b07a8b0e506f1a586896919` (PR #26), with a draft default-deny route guard proposed in this branch. Scope is source and test review only; no production endpoint was probed and no order or payment mutation was attempted.

## Severity matrix

| ID | Severity | Finding | State |
|---|---|---|---|
| SEC-01 | P1 | Native cart completion was not overridden. The custom cart middleware explicitly excluded `/complete`, leaving the framework completion route available to a caller holding a publishable key and cart ID. | Draft fix blocks completion with 404 until ownership-aware checkout is approved and wired. |
| SEC-02 | P1 | Native cart reads and mutations do not require the internal guest ownership proof. `GET /store/carts/:id` is exported directly; mutation wrappers validate checkout lock state, not the guest session. The guest ownership resolver is internal and the storefront BFF transport is unmounted. | Open; requires an ownership-aware API/BFF integration. |
| SEC-03 | P1 | The prototype `POST /store/carts/:id/checkout-lock` checks a feature flag and Idempotency-Key, but does not resolve guest ownership before locking the cart. | Open; keep the flag unset and bind the route to verified ownership before enabling. |
| SEC-04 | P2 | No application-level rate limit was found on cart creation or cart mutation endpoints in the reviewed source. | Open; define abuse limits and test them before enabling public cart transport. |
| SEC-05 | P2 | Browser bundle isolation was not proven by an artifact-level scan. The storefront has server adapters, and the server-only BFF is unmounted; public publishable keys are intentionally public. No private secret value was observed in the reviewed code or returned errors. | Open verification item; scan production browser chunks before transport activation. |

## Endpoint authorization map

| Surface | Implemented access boundary | Review |
|---|---|---|
| Storefront pages: home, products, product detail, cart, checkout | Next.js locale pages; no customer authentication | Cart/checkout remain preview/read-only. No `apps/storefront/app/api` route was present. |
| `GET /store/products`, `GET /store/product-categories`, `GET /store/regions` | Medusa Store API publishable-key scope; product visibility helper scopes to trusted sales channel | Public catalog boundary; inventory availability projection is internal and not mounted. |
| `POST /store/carts` | Native Store API publishable key; no guest-session binding in the reviewed route layer | A cart ID becomes a bearer capability for subsequent native cart routes. |
| `GET /store/carts/:id` | Native Medusa handler is exported directly; publishable key and cart ID | No guest cookie/session ownership check; cart address/email confidentiality depends on cart ID secrecy. |
| `POST/PUT/PATCH/DELETE /store/carts/:id/**` | Native handlers wrapped with checkout-state guard and distributed mutation lock | Prevents mutation during/after locked checkout; does not establish guest ownership. Item prices/totals remain Medusa-owned. |
| `POST /store/carts/:id/checkout-lock` | `PHASE1_ENABLE_PROTOTYPE_ROUTES=true`, UUID v4 Idempotency-Key, lock workflow | No guest ownership check; keep disabled. |
| `POST /store/carts/:id/complete` | Draft override returns 404 without invoking Medusa services | Closed until an approved ownership-aware workflow exists. |
| Guest-session and checkout preflight helpers | Internal modules only; session secret is random, hashed in storage, TTL-bound; proof is an in-memory resolver-issued object | Not mounted as a public endpoint; fails closed on missing, malformed, expired, mismatched, or unavailable ownership. |
| Payment/order routes | No custom public storefront route found in the source API tree; Medusa-native routes may still exist | This review did not invoke them. Keep payment providers and completion disabled; enumerate and explicitly gate any future public payment-session routes before activation. |

## Trust-boundary checks

- Product/variant pricing comes from Medusa calculated EGP prices with an explicit resolved region. Cart adapters send variant ID and quantity, not browser price or currency.
- Availability uses a backend FEFO projection with shelf-life/location policy; it is not mounted publicly. Unknown scope/policy fails closed.
- Shipping configuration contains no approved rate/provider for the reviewed governorates; preflight blocks without trusting a browser amount.
- Checkout preflight consumes a trusted server-resolved cart and ownership proof; a client-provided cart ID or fabricated `{status:"owned"}` object is insufficient.
- Mutation middleware rejects active/completed checkout state and awaits native mutation completion under a distributed lock. It is not an ownership check. The prototype lock route requires an idempotency key, but that alone is not authorization.
- Public error mapping emits fixed messages for known cart conflicts; internal failures fall through to Medusa's generic handler.
- Session secrets are high-entropy, stored as SHA-256 digests, and invalidated/expired server-side. The live cookie-to-BFF transport is not mounted.

## Negative-test evidence

The scoped integration workflow runs the existing ownership, checkout preflight, cart mutation, sales-channel visibility, FEFO, and shipping contract tests. The new test in this draft verifies that `POST /store/carts/:id/complete` returns a not-found error without resolving a commerce service. It makes no network request and cannot create an order or payment.

No unauthorized live API probing was performed. The existing disposable HTTP suites are intended for disposable Postgres/Redis only; TP-01 and canonical acceptance statuses were not run or changed.

## P0/P1 remediation backlog

1. **SEC-02:** Before enabling cart transport, require the HttpOnly guest-session secret on every cart read/mutation route, resolve it server-side, and compare the resolved cart ID to the route ID. Test guest A versus guest B across GET, line-item mutation, address/customer, promotion, shipping, and deletion surfaces.
2. **SEC-03:** Require the same verified ownership proof on checkout-lock; bind idempotency records to both the authenticated guest cart and operation, and reject cross-cart key reuse.
3. **SEC-05:** Split server adapters from browser-safe formatters or enforce `server-only`; inspect generated production chunks for server adapter code and secret values.
4. Add request throttling and bounded payload/quantity limits for public cart/session endpoints.
5. Keep SEC-01's 404 override until explicit authorization, shipping, inventory, pricing, and payment readiness checks are composed into an approved server checkout workflow.

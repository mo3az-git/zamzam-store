# MVP-First — Frontend / Backend Interface Handoff v1

**Status:** PROPOSED contract; schema-checked documentation only, **NOT an implemented route**, endpoint approval or production readiness evidence.
**Owner decision:** development may proceed without the 59 formal TP cases; their acceptance is deferred. **TP-01 is unauthorized**, must not be executed, renamed or marked passed.
**Coordination:** Agent 2 owns storefront/catalog (PR #21). Backend agent owns checkout/stock/payment (PR #19). This integration track owns *interfaces and non-overlapping verification*, not those branches.
**Relevant PRs:** [#19](https://github.com/mo3az-git/zamzam-store/pull/19), [#21](https://github.com/mo3az-git/zamzam-store/pull/21), [#20](https://github.com/mo3az-git/zamzam-store/pull/20), [#23](https://github.com/mo3az-git/zamzam-store/pull/23). See also issue #22.

## What is verified in repository source

| Area | Present today | Gap before actual browser checkout |
| --- | --- | --- |
| Catalog display | PR #21 `apps/storefront/lib/medusa.ts` reads `/store/products` using publishable key; variant selection and EGP display are **read-only** | Confirm real sales-channel/region context, supported Store API fields and content validity; category and localization work belongs to Agent 2 |
| Batch stock | PR #19 internal `batch-inventory/ledger.ts` and FEFO/reservation logic | **No approved safe public batch-availability API**. Native Medusa aggregate availability must not substitute for `batch_inventory` |
| Checkout | PR #19 `completeAndFinalizeSameOrder` and server-side `completePayableReservedCart` use trusted authority | **No approved customer-facing route/composition**; the existing `/store/carts/:id/checkout-lock` endpoint is explicitly a Phase 1 prototype, gated by `PHASE1_ENABLE_PROTOTYPE_ROUTES`, not a live checkout API |
| Payment | PR #19 commits COD/electronic branch records for correlated, completed native order using locked server state | Simulated electronic provider is **not a production gateway**. Guest authorization, payment provider selection/credentials and public operation remain open |
| Alternative foundation | PR #23 contains a read-only payment quote on top of PR #16 | **Overlapping foundation**, not a reason to merge it blindly with PR #19. Prefer PR #19 as checkout/payment integration reference; assess whether any isolated quote validator is useful |

PR #19's [latest checked GitHub Actions run](https://github.com/mo3az-git/zamzam-store/actions/runs/40493938398) succeeded on `0879ef305cc6c32f9260098188db0ce457973ed1`. This is **component/integration evidence**, not customer-payment settlement, production acceptance or a deployed storefront.

## Proposed cross-agent wire shapes (version 1)

The machine-readable payload definitions live at `contracts/mvp-interface-v1.schema.json`. They are design targets only, not claims that current API handlers exist. Route paths, authorization/session mechanisms and deployment mode require backend agreement before exposure.

### 1. Catalog availability — backend authoritative

- Response example: `{"authority":"batch_inventory","items":[{"variantId":"variant_abc","status":"unknown"}]}`
- Allowed public states: `available`, `unavailable`, `unknown`. **Unknown means cannot affirm availability** and must not show "in stock" or enable a purchase based on that response.
- A positive `available` response is allowed **only** from a verified, scoped backend query against `batch_inventory` with a clear reservation consistency policy. No lot IDs, costs, quantities, quarantine balances, lock state or FEFO internals may leave the server.
- Response is informational and **never** reserves inventory. The checkout coordinator independently checks the actual current stock under transaction/lock.

### 2. Checkout intent — untrusted client input

- Example: `{"cartId":"cart_abc","idempotencyKey":"d9ddc33a-9b44-4c84-b36d-f9d5934bc7bd","paymentMethod":"cod"}`
- Client `paymentMethod` expresses **intent only**; server validates and persists selection before payment work. IDs are *locators*, not authorization. No client-supplied amount, version, order ID, `ownerId`, checkout attempt ID, lease token, batch ID or price accepted.
- A real route must derive guest/cart ownership server-side, apply CSRF/origin protections as appropriate, validate session and rate limit, and establish lock, idempotency and checkout authority internally. Avoid a public direct call to the internal finalizer.

### 3. Checkout result — fail closed

- Completed: `{"status":"completed","orderId":"order_abc","currency":"EGP","totalMinor":"6170","orderVersion":1}` — only after authoritative cart→order correlation, inventory conversion and recorded method branch are actually confirmed. Exact string minor units are the source of truth.
- Uncertain: `{"status":"pending_reconciliation","reference":"opaque_customer_status_ref","retryAfterSeconds":10}` — do not auto-create another order, release stock, or claim payment succeeded/failed. Reference must be scoped to authenticated cart/guest authority, unpredictable and safe for clients.
- Blocked: `{"status":"blocked","reasonCode":"CART_NOT_READY"}` — limited allowlisted public reasons, without leaking internals.
- Do not expose checkout lease identity, keys, reservation or movement IDs, full native persistence response, provider internals or sensitive diagnostic messages.
- A public **order status lookup** requires its own authenticated/guest-claim design; this contract does not create a lookup API or deem a reference a bearer credential.

## Implementation order, handoffs and acceptance boundaries

1. **Agent 2 now:** continue read-only product/locale/category delivery; consume only actual supported Store APIs. Keep purchase button disabled while stock and checkout public contracts are unavailable. Prepare a UI adapter interface that can be connected later but does not hardcode imaginary route responses.
2. **Backend agent next:** define scoped batch-availability read and safe guest/cart authority; agree on method persistence, server-only checkout operation, trusted cart amount revalidation, and opaque pending status. Do not expose Phase 1 prototype routes as checkout.
3. **Coordinator:** use schema cases as an executable compatibility checklist; confirm route names/authorization/response shape with both agents, then establish a **single candidate integration branch** from an explicitly reviewed baseline. Do not merge current stacked PRs casually.
4. **Before enabling actual checkout even in staging:** focused checks for cart ownership, authorization, wrong session, inventory contention, replay, unique order, amount/version changes, lost response, unknown outcome, failure compensation and exact EGP reconciliation. Execute in isolated disposable services; **never run TP-01** or silently reclassify its formal status.
5. **Before launch:** approved real payment provider, security and legal/content gates, full formal TP acceptance and separate owner decision on the TP-01/all-59 conflict. Never infer launch readiness from green UI/component CI.

## Non-goals and ownership

This PR does **not** implement public routes, merge branches, change checkout algorithms, create Medusa carts, settle COD or charge cards, change canonical TP registry/checklists, or edit the Agent 2 storefront. The JSON schema is intended to reveal incompatible assumptions early, not to create a new testing marathon.

# Cart and checkout orchestration foundation

## Status and boundary

This is an internal, unmounted BFF contract and orchestration seam. Public order placement remains disabled. The request union has no `complete`, `place_order`, payment execution, or client-selected cart identity operation. `ready_for_review` is a readiness observation only; it is not authorization to create an order or a payment session.

The storefront's existing `apps/storefront/lib/cart.ts` remains a legacy server-side Medusa adapter that accepts cart IDs. It is not a guest-safe public BFF and must not be exposed as one. The current native Store API cart GET and mutation routes remain covered by existing guards, while ownership-aware Store API transport, cookie/CSRF middleware, and request wiring are still absent. Keep the new orchestrator unmounted until security and interface review is complete.

## Wire contract

Implementation: `apps/backend/src/modules/batch-inventory/cart-bff-contract.ts`.

| Operation | Request fields | Result |
| --- | --- | --- |
| `create` | `requestId` | Server-resolved Egypt/EGP cart summary; session secret set only through the trusted cookie adapter. This operation is single-shot because there is no established owner key before creation. An ambiguous timeout must not be retried; ownership cleanup must handle an orphan native cart. |
| `read` | `requestId` | Server-resolved cart summary. |
| `add_item` | `requestId`, `expectedVersion`, `variantId`, `quantity` | Add through the native cart workflow; never accepts price/currency. |
| `update_item` | `requestId`, `expectedVersion`, `lineItemId`, `quantity` | Update quantity through the native cart workflow. |
| `remove_item` | `requestId`, `expectedVersion`, `lineItemId` | Remove through the native cart workflow. |
| `set_delivery` | `requestId`, `expectedVersion`, allowlisted guest/address fields and canonical `governorateId` | Persist the customer address through Medusa; notes remain display-only and must not be placed in address authority fields. |
| `checkout_preflight` | `requestId`, `expectedVersion`, method `cod` or `electronic` | Read-only readiness result and stable blocker codes. No payment/session/order mutation. |

Cart ID, guest owner, EGP currency, prices, totals, stock, provider identity, shipping fee and payment status are not request fields. Responses contain no native cart ID or session secret. Response validation is strict and allowlists fields to prevent accidental serialization of backend DTOs or secrets.

Money crosses the boundary as decimal EGP strings. Native Medusa pricing and totals are the authority; this layer does not calculate `subtotal + shipping`, convert prices through floating point, or accept a browser payable amount. Adapters must normalize Medusa amounts to at most two fractional digits before returning the typed view.

## Orchestration contracts

Implementation: `apps/backend/src/modules/batch-inventory/cart-bff-orchestrator.ts`; guest binding: `apps/backend/src/modules/batch-inventory/cart-bff-guest-ownership.ts`.

- `createCartBffGuestOwnershipAdapter` calls the existing `createGuestCartWithOwnership` flow with an injected server-selected Egypt/EGP region, then resolves the new session with `resolveGuestCartOwnership`. It does not accept a cart or customer ID. Its idempotency owner key is the SHA-256 digest of the cookie secret, matching the stored ownership digest. The generated session secret is delivered only to a Secure, HttpOnly, SameSite cookie setter.
- Every later operation resolves the cookie secret with `resolveGuestCartOwnership`; the returned exact process-local proof and server-resolved cart ID are passed to server-side Medusa reads. Caller-supplied cart IDs are rejected by schema validation.
- Native writes must use Medusa's existing cart lock and checkout-session guard and compare `expectedVersion` again under the lock. Timeouts or ambiguous POSTs are not automatically retried.
- Mutation `requestId` is scoped to the ownership key by a durable idempotency journal. The adapter must replay the saved response for an exact duplicate, reject a changed body under the same key, and fail closed if the journal is unavailable. A server-side journal implementation and version derivation are still required before mounting.
- Preflight composes the existing `evaluateGuestCheckoutPreflight` ownership/address/EGP/native-total result, Agent 3's read-only FEFO interface, Agent 5's server-owned governorate shipping readiness, and Agent 4's payment-method readiness. An `unknown` inventory status blocks; a native shipping method and positive total must already be present; unavailable shipping/payment readiness blocks.
- COD collection/remittance and electronic provider/payment ledgers remain independent. This orchestrator reads method readiness only and writes neither ledger.

## Synthetic test evidence

`apps/backend/scripts/test-cart-bff-orchestrator.mjs` exercises strict request validation, secret/cart ID exclusion, create, add/update/remove, stale-version rejection, owner-scoped mutation-journal invocation, unknown FEFO blocking, unapproved shipping blocking, unavailable payment blocking, a fully synthetic `ready_for_review` result, and the absence of order completion. Its adapters are deterministic nonproduction fixtures; this is contract-level evidence, not a disposable Medusa/PostgreSQL/Redis integration and not a production checkout test.

## Unresolved dependencies before route activation

1. Guest ownership/security owner must supply the approved cookie name/path/domain/TTL/rotation and CSRF/origin policy, then review the transport and session resolver composition.
2. Backend integration owner must implement durable idempotency persistence and a stable Medusa cart version token, with duplicate-body and ambiguous-outcome semantics. The create operation needs explicit single-shot/orphan-cart cleanup behavior.
3. Inventory owner must provide the verified sales-channel-to-inventory-location mapping and per-variant shelf-life policy to `readBatchAvailability`; the current function requires those inputs and intentionally returns `unknown` without them.
4. Fulfillment owner must supply native Medusa quote readiness backed by an approved operator and approved varying rate for every required governorate. Current policy intentionally reports all rates unconfigured and provider undecided.
5. Payment owner must supply a method-readiness interface while keeping COD and electronic ledgers/state machines separate. The electronic gateway and operational owners remain undecided.
6. Security review must establish cookie-backed same-origin BFF routing, CSRF enforcement, origin checks, rate limiting, redacted errors, and endpoint authorization before any route is mounted.
7. Independent disposable PostgreSQL/Redis + Medusa integration must verify native create/read/add/update/remove/address/preflight concurrency and cleanup. A separate owner authorization is required for any future order-completion/TP activity; this work provides neither.

TP-01 remains unauthorized. No canonical TP registry state is changed by this work.


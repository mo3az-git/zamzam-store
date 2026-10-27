# Checkout preflight readiness contract

## Status and boundary

This contract composes the reviewed Cart BFF work in PR #38, server-derived shipping readiness from PR #36, the provider-neutral payment readiness boundary from PR #19, and PR #37's default-deny order-completion route. The PR is stacked on #37. Because the source PRs have divergent ancestry, this branch carries only the focused contract files needed for composition; it does not cherry-pick their branch histories.

The pipeline is internal and read-only. `ready_for_review` is a status for presentation and review only. The result fixes `orderCompletionAllowed`, `paymentExecutionAllowed`, each `publicMethodEnabled`, and each `transactionAllowed` to `false`. It creates no order, payment session, charge, reservation, quote, or shipping price. The public order-completion route remains default-deny.

## Composition

`apps/backend/src/modules/batch-inventory/checkout-preflight-readiness.ts` exports the stable input/result types and the `createCheckoutPreflightReadiness` adapter expected by the Cart BFF.

The server composition supplies only internal read functions:

- The exact ownership proof object returned by the Cart BFF resolver and its server-resolved cart ID. The verifier must be wired directly to `isVerifiedGuestCartOwnership`; a browser-provided cart ID or ownership flag is never accepted.
- Current native cart snapshot and version, Egypt region, EGP currency, governorate, selected native shipping option, subtotal and payable total.
- Batch inventory's `readBatchAvailability` response with its `batch_inventory` authority marker. Unknown/unavailable availability blocks. Positive availability is a provisional read; a later authorized completion path must still reserve/revalidate stock.
- PR #36's `CheckoutShippingQuoteReadiness`, derived from server-owned governorate configuration and native Medusa quote. The selected governorate and option must match and its EGP payable total must equal the native cart total in exact minor units.
- PR #19's `PaymentReadinessSnapshot`, with a separate branch state for COD and electronic payment. No payment readiness is inferred from the selected method. Missing gateway, adapter, native payment sync, COD operations, or other readiness blockers remain explicit.
- Read-only checkout-attempt and owner-scoped replay lookups. Exact replay recomputes readiness from current server state. Reused request IDs with changed fingerprints conflict. Stale, active, completed and uncertain attempts have distinct blockers.

Cart money is compared as decimal strings converted to integer minor units. Floating-point arithmetic, client totals, shipping-fee arithmetic, tariff defaults and synthetic fallback prices are not used. If totals, versions, ownership or any dependency are missing or inconsistent, readiness blocks.

## Result and localization

The result contains `status: blocked | ready_for_review`, selected method, cart version, EGP payable total, independent COD/electronic readiness, and blockers shaped as:

```ts
{ code: CheckoutPreflightBlocker; presentationKey: string }
```

Presentation keys are stable language-neutral identifiers with the prefix `checkout.readiness.blockers.` and a lower-case machine code suffix, for example `checkout.readiness.blockers.shipping_rate_unconfigured`. Storefront Arabic and English resources should provide localized strings for each key; the backend does not machine-translate or embed display copy.

## Current owner decisions and expected result

The electronic gateway and shipping provider remain undecided, and governorate-specific EGP tariffs are unapproved. Therefore the shipping contract currently returns blockers for configuration, and electronic readiness must retain `GATEWAY_NOT_SELECTED` / `AUTHENTICATED_ADAPTER_NOT_CONFIGURED` as applicable. COD and electronic states are independent; neither one can override shipping, ownership, inventory, total or attempt blockers.

A test-only native quote demonstrates the shape of a permitted `ready_for_review` evaluation. It is not a configured rate or a public quote. In production with today's unapproved owner decisions, preflight remains blocked.

## Recovery and future activation

- An exact replay is read-only and recomputes against current cart/version/attempt/configuration state.
- A changed request body under the same owner-scoped request ID returns `PREFLIGHT_REPLAY_CONFLICT`.
- Journal/source unavailability returns `PREFLIGHT_STATE_UNAVAILABLE`; no readiness is inferred.
- An attempt tied to an older version or different method returns `CHECKOUT_ATTEMPT_STALE`; an active attempt blocks retry, a completed attempt blocks reuse, and an uncertain electronic outcome blocks another payment attempt.
- No gateway call or public method activation is part of this contract. Future public order placement requires separately approved tariffs/provider, gateway and COD operations, trusted transport/security composition, inventory revalidation/reservation, payment/native Medusa synchronization, and an independent release decision.

# Shipping quote readiness contract for Checkout

`apps/backend/src/modules/batch-inventory/shipping-quote-readiness.ts` defines the provider-neutral server-to-Checkout handoff. Checkout consumes `CheckoutShippingQuoteReadiness`; it does not infer quote readiness from a selected governorate, configured-looking option, or client-provided amount.

The result is a discriminated union:

- `blocked` carries a canonical governorate ID (or `null` for invalid input), fixed `egp` currency context, and typed blockers. Examples include unknown governorate, undecided/uninstalled provider, unsupported option, unavailable rate, shipping currency mismatch, and non-EGP cart.
- `ready` carries the governorate ID, native shipping option ID, positive decimal-string shipping amount, EGP cart currency, and decimal-string payable total. These values must be read by trusted backend code from the server-owned Medusa cart after native option selection.

The Checkout agent should render localized messages from blocker codes and treat every `blocked` response as non-submittable. The browser must not supply or modify amount, payable total, provider identity, shipping-option availability, or readiness status. Neither this pure contract nor the synthetic test fixture creates a public route, production rate, shipping option, or checkout activation.

The `fixture-provider` and `synthetic-test-only` approvals in contract tests are inert values used to exercise the ready branch; they are not valid production configuration. Production remains blocked until an operator is selected and owner-approved governorate tariffs are recorded.


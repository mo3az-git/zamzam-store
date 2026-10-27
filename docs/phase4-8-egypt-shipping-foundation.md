# Phase 4.8 — Egyptian governorate shipping foundation

## Current decision state

The MVP coverage requirement is all 27 Egyptian governorates, with separate charges by governorate. No rates are approved and the fulfillment operator is undecided. This change does not activate a shipping provider, shipping option, quote, checkout, order, payment, COD settlement, fulfillment, or inventory reservation.

All 27 backend rows remain:

- `coverage: "unconfigured"`
- `rate: { status: "unconfigured" }`
- `fulfillmentProvider: { status: "undecided" }`

A known governorate therefore has three distinct blockers: `SHIPPING_COVERAGE_UNCONFIGURED`, `SHIPPING_RATE_UNCONFIGURED`, and `SHIPPING_PROVIDER_UNDECIDED`. An unknown ID returns only `SHIPPING_GOVERNORATE_UNKNOWN`. No amount defaults to zero.

## Canonical mapping contract for Flash

`apps/backend/src/modules/batch-inventory/egypt-shipping-configuration.ts` is the server-side source of truth. The stable `id` values intentionally match `EGYPTIAN_GOVERNORATES` in `apps/storefront/lib/checkout.ts`. The server accepts only the stable ID; display names and aliases are not identifiers.

| Storefront ID | English | Arabic | ISO 3166-2 | Medusa `province_code` |
| --- | --- | --- | --- | --- |
| `cairo` | Cairo | القاهرة | EG-C | `eg-c` |
| `giza` | Giza | الجيزة | EG-GZ | `eg-gz` |
| `alexandria` | Alexandria | الإسكندرية | EG-ALX | `eg-alx` |
| `qalyubia` | Qalyubia | القليوبية | EG-KB | `eg-kb` |
| `sharqia` | Sharqia | الشرقية | EG-SHR | `eg-shr` |
| `dakahlia` | Dakahlia | الدقهلية | EG-DK | `eg-dk` |
| `gharbia` | Gharbia | الغربية | EG-GH | `eg-gh` |
| `menofia` | Monufia | المنوفية | EG-MNF | `eg-mnf` |
| `beheira` | Beheira | البحيرة | EG-BH | `eg-bh` |
| `kafr_el_sheikh` | Kafr El Sheikh | كفر الشيخ | EG-KFS | `eg-kfs` |
| `damietta` | Damietta | دمياط | EG-DT | `eg-dt` |
| `port_said` | Port Said | بورسعيد | EG-PTS | `eg-pts` |
| `ismailia` | Ismailia | الإسماعيلية | EG-IS | `eg-is` |
| `suez` | Suez | السويس | EG-SUZ | `eg-suz` |
| `north_sinai` | North Sinai | شمال سيناء | EG-SIN | `eg-sin` |
| `south_sinai` | South Sinai | جنوب سيناء | EG-JS | `eg-js` |
| `beni_suef` | Beni Suef | بني سويف | EG-BNS | `eg-bns` |
| `fayoum` | Faiyum | الفيوم | EG-FYM | `eg-fym` |
| `minya` | Minya | المنيا | EG-MN | `eg-mn` |
| `asyut` | Asyut | أسيوط | EG-AST | `eg-ast` |
| `sohag` | Sohag | سوهاج | EG-SHG | `eg-shg` |
| `qena` | Qena | قنا | EG-KN | `eg-kn` |
| `luxor` | Luxor | الأقصر | EG-LX | `eg-lx` |
| `aswan` | Aswan | أسوان | EG-ASN | `eg-asn` |
| `red_sea` | Red Sea | البحر الأحمر | EG-BA | `eg-ba` |
| `new_valley` | New Valley | الوادي الجديد | EG-WAD | `eg-wad` |
| `matrouh` | Matrouh | مطروح | EG-MT | `eg-mt` |

The ISO subdivision list is combined with official Egyptian records that the historic Helwan and 6 October governorates were abolished/merged in 2011; the current contract therefore contains 27 rows. Medusa requires a lower-case ISO 3166-2-style province code for province GeoZones. Its runtime validation checks that `province_code` is a string; it does not verify the code against an authoritative Egypt list. The application map performs that strict check and rejects uppercase, unknown, display-name, and alias inputs.

## Native Medusa contract verified

The backend pins `@medusajs/medusa` and framework packages at 2.22.1. Native fulfillment supports:

- `FulfillmentSet` → `ServiceZone[]` → `GeoZone[]`
- Province GeoZones with `{ type: "province", country_code: "eg", province_code: "eg-c" }`
- Shipping profiles attached to shipping options
- Flat option pricing through native Pricing Module prices/region currency, or calculated pricing through a configured fulfillment provider
- Native cart shipping-option lookup from the server's cart and delivery-address context

The disposable PostgreSQL integration persists and reads back 27 service zones and their 27 province GeoZones. It confirms a native cart shipping-option lookup returns no choices when no shipping options are configured. The fixture deliberately creates no profile, options, prices, or provider selection. Native provider inventory is recorded as evidence only; the built-in `manual_manual` provider is not considered an approved carrier.

The disposable integration now creates one temporary shipping profile and 27 governorate-specific native shipping options with positive synthetic EGP rates. A test-only `manual_manual` provider ID is used solely because Medusa requires a registered provider to instantiate shipping options; this is not an operator decision and these fixtures are deleted before the run exits. The test verifies Cairo address matching, rejects a malformed uppercase province, calculates a positive synthetic option price, attaches that method to a disposable cart, and reads a positive native shipping total/payable total. No public route or storefront configuration reads these rates. The provider-neutral contract still blocks all 27 governorates because rates are unapproved and the production provider remains undecided.

The test proves Medusa's native destination filtering and price/totals behavior for a disposable fixture. It does not prove operational coverage, an approved price, fulfillment performance, or checkout readiness.

## Provider-neutral future rate shape

Each governorate is independently configurable:

```ts
{
  governorateId: "cairo",
  coverage: "unconfigured" | "configured",
  rate:
    | { status: "unconfigured" }
    | {
        status: "approved",
        kind: "flat",
        currencyCode: "egp",
        amount: "125.50", // decimal string, only after owner approval
        approvalReference: "...",
        approvedAt: "..."
      },
  fulfillmentProvider:
    | { status: "undecided" }
    | { status: "selected", providerId: "...", approvalReference: "..." }
}
```

The example amount above illustrates the type only; it is not a proposed or configured fee. The current exported configuration contains no amount values. Money remains a decimal string; this module does not calculate or convert prices. A configuration assessment is not a quote. A future quote must come from Medusa's native option pricing or provider calculation and be read from the resulting native cart.

## Suggested future Medusa topology

After the owner selects an operator and approves every fee, configure a shipping Fulfillment Set with 27 Service Zones, one per governorate, each containing exactly one corresponding province GeoZone. Add an appropriate shipping profile for shippable goods. Because the price differs by governorate, create a separate native Shipping Option for each governorate (or another explicitly reviewed native price-rule model), each tied to the chosen provider and its corresponding Service Zone. Enter approved EGP price records through Medusa's Pricing Module. A calculated option additionally requires the selected provider's actual `calculatePrice` implementation and credentials/configuration, where applicable.

Do not infer a production provider from the current provider list. No topology in this document is installed by application startup.

## Safe handoff

- The storefront should submit only its canonical governorate ID as delivery input; the trusted backend resolves it to `province_code`.
- The backend must derive cart identity from the trusted guest ownership session and retrieve the cart snapshot from Medusa.
- The browser never supplies rate, amount, ownership, provider ID, cart total, or option availability as authority.
- Unrecognized IDs and missing coverage/rate/provider configuration remain blocked.
- Once native options exist, use Medusa's cart-context shipping option workflow and native add/update shipping method workflow. Then read the Medusa cart totals. Do not compute subtotal + delivery fee in storefront or backend adapter code.
- Existing authenticated request, CSRF, cookie, origin, and ownership controls remain prerequisites before a public integration. No route is mounted here.

## Remaining owner decisions

1. Approve an operator/carrier and clarify operational delivery coverage.
2. Approve a separate EGP fee for each governorate, plus effective dates and audit reference.
3. Approve whether all areas inside each governorate are included or whether any local delivery constraints apply.
4. Decide who maintains native service zones, profiles, options, and price records.
5. Approve any required tax, free-shipping, or provider-quote policy.

Until these are resolved and the native configuration is installed, checkout readiness stays blocked.

## Exact configuration steps after approval

1. Record the owner's explicit approval for the fulfillment operator, per-governorate coverage constraints, each of the 27 EGP amounts, effective dates, and approval reference. Keep all rows blocked until every required field is present and validated.
2. Implement or install the selected Medusa fulfillment provider and its credentials/secrets in the server environment. Do not reuse the integration-only `manual_manual` fixture as a production decision.
3. Create the production shipping Fulfillment Set and 27 Service Zones. Each zone must contain exactly the canonical `{ type: "province", country_code: "eg", province_code }` GeoZone for its stable governorate ID; then attach the set to the intended stock location and sales channel.
4. Create or select the Shipping Profile for shippable catalog items and ensure those items use that profile.
5. Create one native flat-price Shipping Option per governorate, tied to its zone, profile, and approved provider. Store only the owner-approved EGP price through Medusa's Pricing Module; do not create a zero/default option for missing approvals.
6. Verify all 27 destination lookups against native cart context, including no match for malformed/unsupported destinations and a blocked result for missing provider, price, zone, or profile configuration.
7. Review the trusted backend cart ownership, CSRF/origin protections, localized failure copy, taxes, and legal delivery copy. Keep public quote/checkout routes disabled until separate approval authorizes activation.
8. After a controlled activation decision, add the native shipping method to the trusted cart and read Medusa's resulting totals. Never calculate the payable total in the storefront, and do not activate COD, payment, order completion, or inventory reservation as part of this configuration step.

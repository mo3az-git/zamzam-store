# Phase 2 Readiness Review — Catalog & Arabic Storefront

**Review type:** Documentary source audit and acceptance planning only.  
**State:** PLANNING PREPARED; PHASE 2 IMPLEMENTATION BLOCKED.  
**Date:** 2026-10-27  
**Owner decision:** Discount coupons remain **Post-MVP**, not a Phase 2 implementation requirement; details intentionally unspecified.

## 1. Inputs inspected

| Canonical source | Relevant contract | Current review finding |
|---|---|---|
| `docs/PROJECT_BRIEF.md` §4.1 | Next.js/TypeScript/Tailwind; homepage, category, product, cart, guest flow, locale, SEO; consume APIs, no direct DB | Basis for catalog/UI backlog; later phase boundaries respected |
| `docs/PROJECT_BRIEF.md` §5 | Default Arabic RTL, secondary English, proposed `/` and `/en`, Egypt-specific currency/forms | P2 localization checklist derived directly |
| `docs/PROJECT_BRIEF.md` §6 | Structured product fields, variants, evidence-backed photos/content, accurate availability | P2-01/P2-02/P2-05/P2-06/P2-08; no genuine public seed content presumed |
| `docs/PROJECT_BRIEF.md` §13 | SEO, accessibility, media/performance, avoid N+1, truthful structured data | P2-09/P2-11 gates |
| `docs/PROJECT_BRIEF.md` §14 | Advanced promotion/coupon engine out of MVP; future extensibility | Owner's Post-MVP coupon decision preserved |
| `docs/implementation-plan.md` §1 & §3 | Sequential Phase 1→2 gate; 59 TP entries; acceptance criteria | P2 code forbidden until independent, authorized gate transition |
| `docs/architecture.md`, `docs/data-model.md` | Medusa modules, product/variant identifiers, batch_inventory authority, checkout identity | Catalog read boundary cannot substitute Medusa generic stock for FEFO batches |
| `docs/risk-and-assumptions.md` | Provenance, Gate 1 documentary restrictions, Egypt EGP and legal defaults | No unsupported origin/authenticity claims in fixtures or storefront |

The above is a documentary mapping, **not** a test run or code audit. No API implementation, UX rendering, media permissions or localization tests are asserted to have passed.

## 2. Entry and exit gates

### Entry blockers
1. Phase 1 is still formally open: requirements call for independent TP evidence and explicit phase transition; TP-01 is unauthorized. **Never run, fabricate, approve or disguise TP-01**. Owner must separately resolve the policy conflict between the all-59 acceptance rule and the TP-01 restriction before any formal phase transition.
2. No verified publishable product catalogue, rights-approved product photography or translated content supplied as approved source assets.
3. A definitive product availability read API respecting batch/FEFO authority and cache freshness is a cross-phase contract; do not invent it.
4. Owner/legal review is required before claiming proven origin, authentic supply chain, legal terms, shipping guarantees or returns promises.
5. The selected media provider, catalog content workflow and English missing-translation fallback rule are not recorded as final owner decisions.

### Future exit evidence (no boxes pre-ticked)
- [ ] Medusa active product/category/variant read contract and unauthorized/archived behavior verified.
- [ ] Arabic default RTL, English LTR, translated primary navigation and forms tested.
- [ ] Categories, product cards, variants and product detail pages tested on mobile/desktop.
- [ ] Authoritative EGP price and correct stock-availability labels demonstrated.
- [ ] Photo rights, alt text, truthful sourcing/product claims reviewed.
- [ ] Accessible keyboard/focus/semantic structure verified.
- [ ] SEO metadata, sitemap/canonical and image/performance behavior verified.
- [ ] Owner-approved policies/contacts and required legal/provenance launch gates recorded.
- [ ] Reproducible build and CI evidence attached to exact commit.
- [ ] Independent P2 acceptance review and phase-transition sign-off recorded.

These are **proposed Phase 2 acceptance checks**, separate from the canonical Phase 1 TP registry. They do not add TP rows or change any `[ ]` status in the existing 59-case plan.

## 3. Contract risks to address before implementation

| Risk | Consequence | Planning mitigation |
|---|---|---|
| Arabic hardcoded late | Mixed LTR/RTL and inaccessible product flows | Locale routing and translation layer before page construction |
| Guessing origin/health claims for water/dates | Misleading goods listing | Require evidence and explicit approval per content field |
| Showing Medusa generic stock instead of batch availability | Incorrect stock promise | Use batch-aware backend availability contract; P3 implementation owner |
| Stale product price/availability | Checkout divergence | Server-side rendering/cache policy with authoritative checkout revalidation |
| Shipping/return/legal copy invented by developers | Consumer misinformation | Owner/legal approval before public publication |
| Product placeholders presented as genuine images | Misrepresentation | Internal-only placeholders visibly identified |
| Unreviewed discount rules | Unexpected revenue/refund behavior | Defer coupons to Post-MVP; retain authoritative paid-after-discount order snapshot |
| Mistaking green prototype CI for public readiness | Premature storefront launch | Separate Phase 1 acceptance, P2 demo evidence, and deployment authorization |

## 4. Proposed sequencing (planning, not implementation authorization)

- **P2-S1 — Contract & localization:** P2-01, P2-02, P2-03; agree data fields, routing/fallback and stock API dependency.
- **P2-S2 — Discovery & products:** P2-04, P2-05, P2-06, P2-08; page layout, listing/detail, images and variants.
- **P2-S3 — Quality & phase handoff:** P2-07, P2-09, P2-10, P2-11, P2-12; stock presentation, SEO, accessibility, policy placeholders, cart/checkout contracts.

Three slices are planning groupings, **not** a schedule commitment and not proof the MVP is three sprints away.

## 5. Explicit handoff checklist

When Phase 1 is authorized and accepted, the P2 implementer should receive:
- Phase 1 acceptance report and granted transition authorization.
- Canonical source briefs plus this backlog/review.
- Confirmed Medusa product Store API and metadata naming.
- Verified sample catalog using permissioned images and owner-approved content.
- Locale routing and product-translation decisions.
- Batch availability API read-contract and cache policy from the inventory owner.
- Required Egyptian currency, product label and legal publication policies.
- A P2 branch/CI/test strategy that never executes TP-01.
- A written decision that discounts/coupons remain **Post-MVP**, with values and limits undecided.

**No product runtime code, schema/migrations, UI components, native checkout behaviors or TP registry entries were changed by this Phase 2 preparation branch.**

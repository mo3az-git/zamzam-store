> **Owner Decisions Superseding This Brief (Revision 19)**
>
> 1. **Payment methods (Gate 6):** Electronic payment and Cash on Delivery (COD) are offered side by side in the MVP. Any statement in this brief that COD is the only or primary payment method, or that online payment gateways or payment webhooks are out of scope, is superseded.
> 2. **Refunds (Gate 4):** The system computes the refund amount. An administrator may approve the computed amount or override it; every override requires an audited reason and approver record.
> 3. **Gateway selection:** No electronic payment gateway has been selected. [DEFAULT-ASSUMPTION] D-1 keeps Phase 0 provider-agnostic; no gateway vendor is selected, and the Phase 1 Spike uses a provider simulator. The owner may change this default; see the Default Assumptions Register.
> 4. **Document precedence:** If this brief conflicts with the Revision 19 Phase 0 documents, the Revision 19 Phase 0 documents take precedence.
>
> **Affected sections in this brief (listed, not edited):**
> - Header metadata: **Primary payment method**
> - **§9.3 — COD behavior**
> - **§10.2 — Order creation transaction** (initial COD payment state)
> - **§14 — Explicitly Out of Scope for the MVP**
>
> The other COD references describe COD-specific states or test cases and remain applicable to the COD branch; they do not make COD the only supported payment method.
>
> ---
>
# Project Brief: Arabic-First E-Commerce Store for Imported Food Products
## MVP Product Requirements, Technical Architecture, and Implementation Plan

**Project type:** Custom e-commerce website  
**Initial market:** Egypt  
**Primary language:** Arabic (Egyptian Arabic context; Modern Standard Arabic for professional product content)  
**Secondary language:** English  
**Default currency:** EGP  
**Initial product categories:** Packaged Zamzam water and packaged dates  
**Primary payment method:** Cash on Delivery (COD)  
**Inventory model:** Existing, locally held inventory, managed by batch and expiration date  
**Architecture proposal:** Next.js + TypeScript storefront, Medusa v2 commerce backend, PostgreSQL database  
**Delivery approach:** Phased implementation with explicit acceptance tests

---

# 1. Your Role and Mission

Act as the lead software engineer and technical architect responsible for designing, building, testing, documenting, and preparing this e-commerce application for deployment.

Build a reliable, maintainable, Arabic-first e-commerce store for selling packaged Zamzam water and packaged dates to customers in Egypt.

The store must support the complete core sales workflow, including product discovery, shopping cart, guest checkout, cash-on-delivery orders, batch-level inventory, expiration-date controls, cost tracking, and a secure administration interface.

Design the system so that new product categories, online payment providers, shipping integrations, and additional operational capabilities can be added later without rewriting the core application.

**Do not begin by generating the entire application in one step.** Start with architecture validation and implementation planning, build in phases, run the relevant tests, and report the results at each milestone.

The goal is a working, testable application, not merely a collection of attractive UI screens or a prototype with nonfunctional controls.

# 2. Business Context and Assumptions

Use the following assumptions unless the project owner explicitly changes them.

1. The business initially sells packaged Zamzam water and packaged dates.
2. Products are purchased in packaged, ready-to-sell form. The business does not repackage or manufacture them in the initial release.
3. Products are already physically available in Egypt before they are listed as available for immediate delivery.
4. The initial target market is consumers in Egypt.
5. Arabic is the primary interface language. English must be supported by the architecture and provided as a secondary user-selectable language.
6. The initial payment method is Cash on Delivery.
7. Shipping prices and delivery status are managed manually in the first release. Automated carrier integrations are deferred.
8. The first release uses a small, manageable catalog and one initial inventory location.
9. Product batch tracking, expiration tracking, cost history, and inventory integrity are mandatory MVP requirements.
10. Customers should be able to place orders without creating an account.

Do not assume that a specific shipping provider, online payment gateway, legal authorization, product certification, or supplier integration has been approved.

## Important product and compliance constraint

The owner has indicated that some products may not have conventional purchase invoices. Do not fabricate invoices, certificates, supplier records, product origins, or regulatory approvals. Do not implement functionality intended to conceal missing documentation.

Provide a secure way to record available supplier, provenance, purchase-cost, customs-related, and supporting-document information. The owner must independently confirm that the goods can lawfully be resold and that all applicable food-safety, labeling, consumer-protection, tax, and documentation requirements have been met before production sales begin.

For Zamzam water in particular, the owner must verify the actual source, packaging, product identification, and applicable authorization requirements before the product is listed as available for sale.

The application must not publish unsupported claims such as "officially certified," "authentic," "original," or similar claims without evidence approved by the owner.

---

# 3. Implementation Principles

Follow these principles throughout the project.

- Arabic-first, mobile-first user experience.
- Server-side validation for all security-sensitive and commercially important operations.
- A single authoritative source of truth for prices, orders, inventory, and order totals.
- Database transactions for order creation and stock reservation.
- Explicit inventory movement records; do not silently overwrite inventory history.
- Accurate distinction between order status, fulfillment status, and COD payment status.
- No expired batch may be sold.
- Cost and price changes must not rewrite historical order values.
- Secrets must never be exposed to the storefront.
- No mock functionality may be presented as operational functionality.
- No production data or real payment credentials should be used during development.
- Every major feature must have documented acceptance criteria and relevant tests.
- Keep the first release small. Avoid unnecessary services, microservices, AI features, and integrations.

# 4. Proposed Technical Architecture

Use this architecture as the default proposal, subject to a short feasibility review before implementation.

## 4.1 Storefront

**Technology:** Next.js App Router, TypeScript, and Tailwind CSS.

Responsibilities:

- Homepage and navigation.
- Product category and product listing pages.
- Product detail pages.
- Cart.
- Guest checkout.
- Order confirmation.
- Customer-facing order tracking or status lookup.
- Arabic/English language switching.
- Search engine optimization and responsive design.

Use server-rendered pages or static rendering where appropriate for catalog and content pages. Use client-side interactivity only where needed.

The frontend must consume the commerce backend through defined API interfaces. It must not directly access the database.

## 4.2 Commerce Backend

**Technology:** Medusa v2.

Use the built-in commerce functionality for supported product, cart, order, pricing, and inventory operations wherever appropriate.

Extend it with custom functionality for:

- Inventory batches and expiration dates.
- Batch-specific unit costs.
- Batch allocation using FEFO.
- Inventory movement history.
- Batch-aware reservations.
- Batch-aware returns and inventory adjustments.
- Relevant administration screens and operational reports.

Do not assume that Medusa's standard inventory functionality already implements all batch, expiration, or costing requirements. Verify the current official documentation and implement the required capabilities explicitly.

Do not modify Medusa core source code unnecessarily. Prefer supported custom modules, workflows, API routes, event subscribers, and administration extensions.

Official documentation:
- Medusa: https://docs.medusajs.com/
- Medusa customization overview: https://medusajs.com/v2-overview

## 4.3 Database

**Technology:** PostgreSQL.

Use database migrations to manage schema changes. Keep the database schema normalized where appropriate, but do not overcomplicate it.

Requirements:

- Use appropriate primary keys, foreign keys, unique constraints, and indexes.
- Use database transactions for operations that must succeed or fail together.
- Use exact decimal/numeric representations for monetary amounts rather than floating-point arithmetic.
- Store timestamps consistently, preferably in UTC, while displaying dates in the appropriate Egyptian context.
- Store expiration dates as calendar dates when time-of-day precision is not required.
- Avoid hard deletion of orders, inventory movements, or batches that have historical business significance.
- Add appropriate uniqueness constraints and concurrency protection.

Use a managed PostgreSQL service for production if practical. Select the provider after evaluating reliability, backup capabilities, region availability, cost, and deployment compatibility.

## 4.4 Media Storage

Use Cloudinary or an S3-compatible object storage service for product images and other uploaded media.

Requirements:

- Store image references and metadata in the application, not entire image binaries in database records.
- Restrict administrative uploads to appropriate file types and sizes.
- Optimize product images for web delivery.
- Keep secrets and private documents separate from publicly accessible product media.
- Do not place supplier invoices or sensitive provenance records in publicly accessible storage.

## 4.5 Project Organization

Use a clear, maintainable repository structure. A monorepo may be used if it simplifies shared types, scripts, and development.

For example:

```text
store-project/
  apps/
    storefront/
    backend/
  packages/
    shared-types/
  docs/
    architecture.md
    data-model.md
    implementation-plan.md
    operations.md
  .env.example
  README.md
```

Adapt this structure to the conventions of the selected framework. Do not create unnecessary packages simply to match this illustration.

---

# 5. Arabic-First Localization and User Experience

Arabic is the default language, not a translation added after the interface is finished.

## 5.1 Arabic requirements

- Arabic must be the primary language shown to first-time visitors.
- Use correct right-to-left layout behavior.
- All primary navigation, product pages, forms, buttons, validation messages, order statuses, and customer-facing notices must be available in Arabic.
- Use Arabic-compatible fonts with good readability.
- Use CSS logical properties such as `margin-inline-start` and `padding-inline-end` where appropriate.
- Ensure that forms, icons, breadcrumb navigation, product grids, menus, dialogs, and checkout behave correctly in RTL.
- Test on common mobile screen sizes.
- Ensure that Arabic text does not overflow, clip, or become misaligned.

## 5.2 English support

Implement a proper localization structure so that English can be enabled without rewriting pages.

Recommended routing:

- Arabic: `/`
- English: `/en`

The precise routing implementation may follow the current Next.js App Router conventions.

Requirements:

- Add a visible language selector.
- Preserve the equivalent page when switching languages where practical.
- Localize system-generated messages and validation errors.
- Provide localized product content where translations are available.
- Avoid hardcoding interface strings inside components.
- Ensure the document language and text direction are set correctly for each locale.

Official reference: https://nextjs.org/docs/app/guides/internationalization

## 5.3 Egypt-specific presentation

- Default currency: EGP.
- Use appropriate Egyptian currency formatting.
- Accept Egyptian phone numbers and normalize them consistently.
- Design address fields for Egyptian governorates, cities/areas, streets, buildings, and optional delivery landmarks.
- Allow shipping charges to vary by configured delivery area.
- Do not assume a shipping price or delivery timeframe that the business has not configured.
- Use configurable values for business contact details, delivery policies, and other operational settings.

## 5.4 Suggested storefront pages

Implement these pages for the MVP:

1. Homepage.
2. Product category/listing page.
3. Product detail page.
4. Shopping cart.
5. Checkout.
6. Order confirmation.
7. Order status lookup.
8. About the store.
9. Contact information.
10. Shipping and delivery policy.
11. Returns and refunds policy.
12. Privacy policy.
13. Terms of service.

Policy pages must use owner-reviewed content. Do not invent guarantees or legal terms.

---

# 6. Product Catalog

Build a manageable catalog that supports current products and future categories.

## 6.1 Product fields

Each product should support, as appropriate:

- Stable product ID.
- Product name in Arabic.
- Product name in English.
- URL slug.
- Category.
- Description in Arabic and English.
- Product images.
- Selling price.
- SKU or SKU per variant.
- Product status: draft, active, or archived.
- Availability status.
- Package size or net quantity.
- Unit of measure.
- Brand or supplier-provided product identification, where verified.
- Country of origin, only when supported by evidence and appropriate for display.
- Ingredients or product composition, if applicable and verified.
- Storage instructions, where applicable.
- Expiration-tracking requirement.
- Minimum remaining shelf life required at sale or dispatch, where relevant.
- Product metadata suitable for future expansion.

Use structured fields for important product information rather than placing everything into an unstructured description.

## 6.2 Product variants

Support variants for products that have distinct package sizes or other commercially meaningful differences.

Each variant should have:

- Its own SKU.
- Its own price if necessary.
- Its own inventory relationship.
- Its own package size or specification.
- Appropriate images where the variants differ visually.

Do not treat separate package sizes as interchangeable inventory unless the business explicitly defines that behavior.

## 6.3 Product images

Use actual product photos or official supplier images that the business is authorized to use.

Never use a generic image and present it as the actual Zamzam water bottle, packaging, or date product.

Development placeholders may be used internally, but must be clearly marked and must not be published as genuine product photography.

Provide image fields supporting:

- Primary image.
- Gallery images.
- Alt text in Arabic and English.
- Optional display ordering.

Do not manufacture certification badges, quality claims, customer reviews, sales counters, or false scarcity indicators.

## 6.4 Catalog behavior

Customers must be able to:

- Browse active categories.
- Browse active products.
- View product details and images.
- See the selling price.
- See whether a product is available.
- See an appropriate unavailable or out-of-stock message.
- Select available variants, where relevant.
- Add available products to the cart.

The displayed available quantity must not expose internal inventory-sensitive information unnecessarily. Showing an accurate in-stock/out-of-stock status is sufficient for the MVP.

---

# 7. Custom Inventory Batch and Expiration Management

**This is a core MVP subsystem. Do not defer it.**

The application must track stock by product variant and physical inventory batch, not only by a single aggregate stock number.

## 7.1 Batch information

Create a custom inventory batch entity with fields equivalent to:

- Batch ID.
- Product variant ID.
- Internal batch reference.
- Supplier-provided lot or batch number, when available.
- Supplier ID or supplier reference.
- Received date.
- Expiration date.
- Quantity received.
- Quantity currently on hand.
- Quantity reserved.
- Quantity allocated to fulfilled orders.
- Unit purchase cost.
- Allocated additional costs, if applicable.
- Final unit cost under the selected costing method.
- Source/provenance notes.
- Supporting-document references, where available.
- Batch status.
- Created and updated timestamps.
- Inventory location ID, if supported by the chosen architecture.

Do not invent a supplier batch number if one is absent. Use an internal identifier while preserving the difference between the internal ID and the manufacturer's or supplier's original lot number.

## 7.2 Batch statuses

Support operational statuses such as:

- Available.
- Quarantined or awaiting review.
- Expired.
- Damaged or non-sellable.
- Depleted.

A batch that is expired, quarantined, damaged, or otherwise blocked must not be sold.

The owner must confirm which products require expiration tracking and whether any product is permitted to lack an expiration date. For the initial packaged food inventory, default to requiring the expiration date for every expiration-tracked batch.

## 7.3 FEFO allocation

Implement **FEFO (First Expired, First Out)**.

When allocating a sale, select eligible batches with the earliest expiration dates first.

Eligible stock must satisfy all applicable requirements:

- Batch status permits selling.
- Expiration date is later than the applicable business date.
- Remaining shelf life satisfies the product's configured minimum, if one exists.
- Stock is not already reserved for another order.
- Stock belongs to an enabled inventory location.

If the earliest-expiring batch does not contain sufficient stock, allocation may continue into the next eligible batch.

If sufficient eligible stock is unavailable across all eligible batches, reject the order or prevent the unavailable quantity from being purchased.

## 7.4 Preventing expired-product sales

Expiration validation must run on the backend, not only in the storefront.

The system must check eligibility:

1. When inventory is received or adjusted.
2. When an order is created.
3. When stock is allocated and reserved.
4. When an order is prepared for dispatch.
5. When a stock adjustment is performed.
6. When returned goods are considered for resale.

A product with zero eligible stock must not be purchasable, even when an aggregate inventory number suggests that physical stock still exists.

Provide configurable expiration warnings, initially supporting 90-, 60-, and 30-day thresholds. These thresholds should be adjustable by the administrator.

Warnings should identify the product, batch, expiration date, remaining quantity, and estimated inventory value where available.

## 7.5 Inventory reservations

When a valid COD order is accepted:

- Validate stock availability.
- Select eligible batches.
- Reserve the required quantities.
- Create the order and allocation records.
- Complete these operations atomically.

If any required step fails, do not leave a partially created order or partially reserved stock.

When an order is cancelled before fulfillment, release its reservations according to the defined order-state rules.

When an order is fulfilled, update reserved and remaining quantities consistently with the inventory model.

Protect against concurrent purchases of the same final units. Use appropriate transaction boundaries, row locking or equivalent concurrency control, and database constraints.

Do not reserve stock simply because a visitor adds it to a cart. Stock reservation should follow the accepted-order rules defined for this MVP.

## 7.6 Inventory movement history

Maintain an inventory movement ledger.

Each movement should record:

- Product variant.
- Batch.
- Quantity change.
- Movement type.
- Related order, return, receipt, or adjustment where applicable.
- Timestamp.
- Authorized actor or system process.
- Reason for manual adjustments.
- Relevant before/after quantities where appropriate.

Examples include:

- Stock receipt.
- Order reservation.
- Reservation release.
- Fulfillment.
- Return received.
- Return accepted back into sellable inventory.
- Expiration block.
- Damage write-off.
- Inventory correction.

Historical movement records must not be silently overwritten.

## 7.7 Returns and product safety

Returned goods must not automatically become sellable inventory.

For the MVP, the administrator must record the return and inspect its condition before deciding whether any quantity can be returned to sellable stock.

If returned food products have compromised packaging, uncertain storage conditions, or expired dates, keep them out of sellable inventory.

---

# 8. Cost Tracking and Historical Financial Accuracy

Provide basic operational cost reporting without claiming to replace a full accounting system.

## 8.1 Batch costs

Each inventory batch must preserve the purchase cost and applicable allocated additional costs that were recorded when the stock was received.

Support:

- Purchase cost.
- Additional batch costs.
- Quantity received.
- Derived unit cost.
- Costing method.
- Cost adjustment history.

An updated product cost must never retroactively overwrite the cost associated with previously received stock.

If additional import, freight, clearance, or other costs are not known at the time of receipt, allow authorized users to record them later as adjustments while preserving the audit trail.

Do not assume every cost has a tax invoice or other formal document. Record the supporting-document status accurately.

## 8.2 Costing method

Use batch-specific cost allocation for the MVP, consistent with FEFO stock allocation, unless a qualified accountant specifies a different method.

The exact financial reporting method must be documented and reviewed before the business relies on the reports for statutory accounting.

## 8.3 Order price snapshots

When an order is accepted, preserve:

- Product name as purchased.
- SKU and variant.
- Unit selling price.
- Quantity.
- Applied discount, if supported.
- Line total.
- Shipping fee charged to the customer.
- Order total.
- Allocated batch IDs.
- Cost basis used for the operational margin calculation, where available.

Subsequent catalog price changes must not change historical order values.

## 8.4 Initial profitability reporting

Provide basic reports showing:

- Gross sales.
- Discounts.
- Shipping charged to customers.
- Estimated cost of goods sold.
- Estimated gross margin.
- Variable fees and expenses when recorded.
- Cancellation and return counts.
- Stock value by batch.
- Stock approaching expiration.

Clearly label calculated margins as estimates when some expenses or supporting data are missing.

Do not describe gross margin as net profit.

---

# 9. Shopping Cart and Guest Checkout

The customer must be able to place an order without creating an account.

## 9.1 Shopping cart

Support:

- Adding available products.
- Updating quantities.
- Removing items.
- Variant selection.
- Recalculating totals on the server.
- Availability validation.
- Appropriate empty-cart and error states.
- Cart persistence across ordinary navigation where practical.

The backend is authoritative for prices, discounts, shipping charges, and available inventory.

Never trust a price or total supplied by the browser.

## 9.2 Checkout fields

Collect only the information needed to deliver the order.

Required fields should include:

- Customer full name.
- Egyptian mobile phone number.
- Governorate.
- City or area.
- Street and building details.
- Additional address detail where needed.
- A nearby landmark or delivery instruction, when applicable.

Allow the customer to review:

- Ordered products.
- Quantities.
- Subtotals.
- Shipping charge.
- Final amount payable.
- Payment method.
- Delivery address.

Shipping prices should come from administrator-configured delivery areas or rules. Do not invent a delivery price for an unsupported region.

Validate required fields on both the frontend and backend.

## 9.3 COD behavior

COD is the only payment method in the first release.

The UI must clearly explain that the customer pays at delivery.

New orders must not automatically be marked as paid.

Maintain a distinct COD payment status, such as:

- Unpaid / awaiting collection.
- Collected.
- Collection failed.
- Refunded, if applicable.

Order status, fulfillment status, and payment status must remain separate concepts.

Allow authorized administrators to record actual collection of the COD amount and the relevant date. Do not consider an order fully financially settled merely because its delivery status changes.

Online payment integration is explicitly out of scope for this MVP.

---

# 10. Order Lifecycle and Order Integrity

Define the lifecycle explicitly before implementing order management.

A suggested initial state model is:

- New.
- Confirmed.
- Preparing.
- Shipped.
- Delivered.
- Cancelled.
- Return requested.
- Returned.
- Partially returned, if required by the supported return process.

Adapt the exact implementation to Medusa's current order and fulfillment model. Do not duplicate existing lifecycle functionality unnecessarily.

## 10.1 Allowed transitions

Document permitted transitions and reject invalid transitions.

Examples:

- New → Confirmed.
- New → Cancelled.
- Confirmed → Preparing.
- Preparing → Shipped.
- Shipped → Delivered.
- Delivered → Return requested.
- Return requested → Returned, after the relevant process is recorded.

The administrator must not be allowed to mark an order as delivered before it has been shipped, unless an explicitly documented corrective process permits it.

Cancelled and completed orders must not be casually reopened. Any exceptional correction must be authorized and logged.

## 10.2 Order creation transaction

Order creation must atomically handle:

- Validating product availability and prices.
- Validating checkout data.
- Calculating the order total.
- Creating the order and immutable line-item price snapshots.
- Allocating stock from eligible batches.
- Creating stock reservation records.
- Recording an initial COD payment state.

If stock allocation or another required operation fails, roll back the entire operation.

Protect against duplicate order submission caused by double-clicks, browser retries, or network timeouts. Use an appropriate idempotency strategy and return a consistent result when the same submission is retried.

Do not assume that preventing double-clicks in the frontend is sufficient.

## 10.3 Customer order confirmation

After successful order creation, display a confirmation page with:

- Order reference.
- Ordered products.
- Total amount due.
- Delivery address.
- COD payment information.
- Next steps.

Do not display sensitive information to someone who knows or guesses an order number.

Order lookup must use a sufficiently protected access mechanism, such as a high-entropy order access token or an appropriate order-reference and phone-verification mechanism.

Do not expose customer addresses, phone numbers, or other orders through public APIs.

## 10.4 Manual shipment tracking

For the MVP, the administrator can record:

- Carrier name.
- Tracking number.
- Shipment date.
- Delivery status.
- Notes.
- Delivery or failed-delivery dates, where applicable.

No carrier API is required for the first release. The system must clearly distinguish manually entered shipment information from verified carrier events.

Automated shipping integrations are deferred to a later phase.

---

# 11. Administration Interface

The administration interface is a core feature, not an afterthought.

Use Medusa's supported administration and extension mechanisms where practical. If custom screens or APIs are required for batch-level inventory management, implement them explicitly.

## 11.1 Product management

Authorized staff must be able to:

- Create and edit products.
- Manage Arabic and English content.
- Upload and order product images.
- Manage categories and variants.
- Set selling prices.
- Activate, deactivate, or archive products.
- Mark products as unavailable.
- Review relevant inventory information.

## 11.2 Batch management

The administrator must be able to:

- Receive new stock into a batch.
- Record the supplier and available source documentation.
- Record lot number and expiration date.
- Record quantities and costs.
- View batch quantities and status.
- Place a batch into quarantine.
- Mark a batch as damaged or otherwise non-sellable.
- View approaching and expired batches.
- Review batch movement history.
- Perform authorized stock adjustments with a reason.

Do not allow administrators to silently change historical batch costs or delete referenced batches.

## 11.3 Order management

The administrator must be able to:

- View and search orders.
- Filter orders by status and date.
- View order details and customer delivery data.
- Review allocated batches.
- Confirm or cancel orders.
- Prepare and ship orders.
- Enter a tracking number manually.
- Record delivery outcomes.
- Record COD collection.
- Record returns and their inspection outcome.
- Review order and inventory history.

## 11.4 Dashboard

Provide a useful, simple dashboard showing:

- New orders awaiting action.
- Orders being prepared or shipped.
- Orders with delivery issues.
- Low-stock products.
- Batches nearing expiration.
- Expired or quarantined stock.
- Basic sales and inventory figures.

Keep the dashboard focused on operational decisions rather than decorative charts.

## 11.5 Access control

Implement authenticated administration with least-privilege access.

At minimum, support an administrator role. Add a limited staff role if required by the implementation.

- No public admin registration.
- No reliance on hiding admin URLs.
- Server-side authorization for every protected operation.
- Restrict cost data and supplier documents to authorized staff.
- Audit sensitive administrative actions.
- Require reauthentication for sensitive account or security changes where appropriate.
- Use MFA if the selected authentication approach supports it reliably.

---

# 12. Security, Privacy, and Reliability

Security is part of the MVP.

Implement:

- HTTPS in production.
- Secure authentication and session handling.
- Server-side authorization checks.
- Input validation and output encoding.
- Protection against SQL injection, cross-site scripting, and other common web risks.
- Rate limiting or equivalent controls for sensitive endpoints.
- CSRF protections where applicable to the authentication model.
- Secure password hashing if passwords are managed directly by the application.
- Secrets stored in environment variables or an appropriate secret manager.
- No credentials or secret API keys committed to source control.
- Restricted CORS configuration where needed.
- Secure handling of customer information.
- Error responses that do not expose stack traces or internal secrets.
- Dependency auditing and timely security updates.
- Protection of uploaded files and private documents.
- Database backups and a documented recovery procedure.

Do not log payment secrets, authentication tokens, full private addresses unnecessarily, or other sensitive information.

Maintain structured logs for operational debugging, but minimize personal data in those logs.

Document the basic retention and deletion rules for customer information and confirm the relevant legal requirements with the business owner.

## 12.1 Backup and recovery

Configure automated database backups suitable for the selected hosting service.

Document:

- Backup frequency.
- Retention period.
- Recovery procedure.
- Required credentials and access permissions.
- How a restore is tested.

A backup is not considered verified until a restore test has succeeded. Perform at least one documented restoration test before production launch.

## 12.2 Error monitoring

Record sufficient technical information to diagnose:

- Failed order creation.
- Inventory conflicts.
- Failed database operations.
- Invalid state transitions.
- Failed administrative actions.
- Unexpected application errors.

Provide a basic operational health check without exposing private information.

---

# 13. SEO, Accessibility, and Performance

## 13.1 SEO

Implement:

- Meaningful page titles and meta descriptions.
- Canonical URLs where appropriate.
- XML sitemap.
- Robots directives.
- Semantic HTML.
- Descriptive product URLs.
- Appropriate product structured data where the displayed claims and values are accurate.
- Correct Arabic language and direction metadata.
- Correct localized metadata for English pages.
- Social sharing metadata where useful.

Do not emit structured data claiming product availability, ratings, price, or certifications that are inaccurate.

## 13.2 Accessibility

Use semantic elements, keyboard-accessible navigation, visible focus states, useful error messages, and appropriate contrast.

Ensure Arabic forms and labels are accessible.

Product images must have suitable alt text. Do not use images as the only way to communicate essential information.

## 13.3 Performance

- Optimize images.
- Avoid unnecessary client-side JavaScript.
- Avoid loading every product image at full resolution.
- Use pagination or reasonable listing limits where needed.
- Add database indexes for frequently queried fields.
- Avoid N+1 queries in catalog and order screens.
- Test the storefront on mobile connections and common device sizes.

Do not sacrifice inventory correctness for caching speed. Availability and prices must be validated against authoritative backend data during checkout.

---

# 14. Explicitly Out of Scope for the MVP

Do not implement the following unless the owner approves a scope change:

- Online payment gateways.
- Automated payment webhooks.
- Shipping-provider API integration.
- Customer account registration and full account management.
- Loyalty programs.
- Advanced promotions and coupon engines.
- Product reviews and ratings.
- AI chatbots and recommendation systems.
- Native mobile applications.
- Multiple warehouses, unless required by actual operations.
- Multi-vendor marketplace functionality.
- Complex accounting or tax filing software.
- Multi-currency selling.
- Microservices architecture.

The design must allow future extensions, but these features should not delay a reliable first release.

---

# 15. Proposed Data Model

Before implementation, produce an ER diagram or equivalent model and document the relationships.

At minimum, design for the following entities or their appropriate Medusa equivalents:

| Entity | Responsibility |
|---|---|
| Product | Product description, category, and localized content |
| Product Variant | Sellable package or variant, SKU, price, and product-specific settings |
| Inventory Location | Physical location holding stock |
| Inventory Batch | Batch-level quantities, expiration, status, and cost |
| Inventory Movement | Auditable stock movements |
| Batch Allocation / Reservation | Connection between orders and the specific batches reserved |
| Order | Customer order, status, and totals |
| Order Item Snapshot | Historical item name, SKU, price, quantity, and line total |
| Order Batch Allocation | Batch-level traceability and cost basis for sold items |
| Shipment Record | Manual carrier information, tracking number, and delivery events |
| COD Collection Record | Amount collected, date, status, and notes |
| Return Record | Return reason, inspection outcome, and stock disposition |
| Supplier | Supplier information and references to available documentation |
| Cost Adjustment | Additional or corrected batch-cost information with an audit trail |
| Admin User / Role | Authorized administration access |
| Audit Log | Important administrative and financial actions |
| Store Settings | Configurable policies, shipping prices, contact information, and thresholds |

Do not duplicate entities already properly provided by Medusa without a clear architectural reason.

Define relationships, indexes, constraints, and the transaction boundaries that guarantee inventory consistency.

Produce the actual schema and migration plan during Phase 0.

---

# 16. Testing Requirements and Acceptance Criteria

The MVP is not complete when the pages render. It is complete when the relevant business behavior is verified.

## 16.1 Catalog acceptance tests

- Active products are visible.
- Archived or inactive products cannot be purchased.
- Prices and variants are accurate.
- Missing translations have a defined fallback or are clearly handled.
- Product pages render correctly in Arabic RTL.
- Images displayed as product images correspond to the actual product or authorized product imagery.

## 16.2 Inventory acceptance tests

**Test A: FEFO**

Given two sellable batches of the same variant, the earlier-expiring batch is allocated first, subject to the configured minimum remaining shelf-life rule.

**Test B: Expired stock**

Given an expired batch with physical stock remaining, an order cannot allocate or reserve that stock.

**Test C: Mixed stock**

Given both expired and valid stock, the valid available quantity is the only quantity eligible for sale.

**Test D: Concurrent orders**

Given only one eligible unit remains, two simultaneous order attempts must not both reserve it successfully.

**Test E: Cancellation**

When a reserving order is cancelled before fulfillment, its reserved units are released exactly once.

**Test F: Stock adjustment**

Authorized manual adjustments create movement history and preserve the previous record of events.

**Test G: Returns**

Returned goods do not become sellable inventory automatically. They must pass the specified inspection process.

**Test H: Expiration alerts**

Batches enter the relevant warning categories based on configured thresholds.

## 16.3 Order acceptance tests

- A valid COD checkout creates exactly one order.
- An invalid checkout cannot create a usable order or reserve stock.
- Retrying the same order submission does not create duplicate orders.
- The order total is computed by the backend.
- Historical order prices remain unchanged when the catalog price changes.
- A cancelled order does not remain incorrectly reserved.
- Invalid order-state transitions are rejected.
- The customer cannot retrieve another customer's order data simply by guessing an order number.

## 16.4 Cost acceptance tests

- A received batch retains its recorded unit cost.
- A cost adjustment records the reason and leaves the audit history intact.
- Order items retain their original selling-price snapshots.
- Batch allocations can be traced to the relevant inventory records.
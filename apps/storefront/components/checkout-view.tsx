"use client"

import Link from "next/link"
import { useState } from "react"
import { getDictionary, localePath, type Locale } from "../lib/i18n"
import { formatEgpAmount } from "../lib/medusa"
import type { SanitizedCart } from "../lib/cart-types"
import { SYNTHETIC_CART_PREVIEW_FIXTURE } from "../lib/cart-types"
import {
  EGYPTIAN_GOVERNORATES,
  getInMemoryCheckoutState,
  mapGuestCheckoutToBackend,
  setInMemoryCheckoutState,
  SYNTHETIC_QA_READINESS_FIXTURE,
  type CheckoutReadinessState,
  type GuestCheckoutFieldErrors,
  type GuestCheckoutInput,
  type PreflightBlocker,
} from "../lib/checkout"

export interface CheckoutViewProps {
  locale: Locale
  isQaMode: boolean
  initialCart?: SanitizedCart | null
}

/**
 * Bilingual Guest Checkout Details & Readiness UI (Phase 4.4 MVP).
 *
 * Aligned with backend preflight contract:
 * - Synthetic fixtures strictly gated by server-verified `isQaMode` (URL query parameters cannot activate).
 * - Validated first/last name, email, normalized Egyptian mobile, and governorate/province mapping.
 * - Optional delivery notes kept strictly outside the Medusa CartAddress payload.
 * - Read-only Checkout Readiness display observing backend preflight blockers.
 * - Place Order and Payment buttons remain hard-disabled.
 */
export function CheckoutView({ locale, isQaMode, initialCart = null }: CheckoutViewProps) {
  const dict = getDictionary(locale)

  // Priority 1: Synthetic fixtures are ONLY accessible when server-verified isQaMode === true.
  // URL query parameters (e.g. ?preview=sample) alone CANNOT activate synthetic fixtures.
  const activeCart: SanitizedCart | null =
    initialCart ?? (isQaMode ? SYNTHETIC_CART_PREVIEW_FIXTURE : null)

  const items = activeCart?.items ?? []
  const hasItems = items.length > 0

  // Form state initialized from in-memory cache to preserve inputs across language switching
  const [formData, setFormData] = useState<GuestCheckoutInput>(() => getInMemoryCheckoutState())
  const [errors, setErrors] = useState<GuestCheckoutFieldErrors>({})
  const [qaSimulatedSuccess, setQaSimulatedSuccess] = useState<boolean>(false)

  // Read-only readiness state: In QA mode, initialized with synthetic preflight fixture.
  // In non-QA mode, authoritative blockers strictly prevent checkout.
  const [readinessState, setReadinessState] = useState<CheckoutReadinessState>(() => {
    if (isQaMode) return { ...SYNTHETIC_QA_READINESS_FIXTURE }
    return {
      status: "blocked",
      blockers: [
        "CHECKOUT_OWNERSHIP_UNAVAILABLE",
        "MISSING_SHIPPING_ADDRESS",
        "MISSING_SHIPPING_METHOD",
        "SHIPPING_PRICE_UNAVAILABLE",
      ],
      readiness: {
        deliveryAddress: false,
        shippingMethod: false,
        shippingPrice: false,
        payableTotal: Boolean(activeCart?.subtotal),
      },
    }
  })

  const handleFieldChange = (field: keyof GuestCheckoutInput, value: string) => {
    const updated = { ...formData, [field]: value }
    setFormData(updated)
    setInMemoryCheckoutState({ [field]: value })
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const handleQaSimulate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isQaMode) return

    const mapping = mapGuestCheckoutToBackend(formData, dict)
    if (!mapping.success) {
      setErrors(mapping.errors)
      setQaSimulatedSuccess(false)
      setReadinessState((prev) => ({
        ...prev,
        readiness: { ...prev.readiness, deliveryAddress: false },
        blockers: Array.from(new Set([...prev.blockers, "GUEST_DELIVERY_INVALID" as PreflightBlocker])),
      }))
      return
    }

    // Contract successfully mapped without ambiguous heuristics
    setErrors({})
    setQaSimulatedSuccess(true)
    setReadinessState((prev) => ({
      ...prev,
      readiness: { ...prev.readiness, deliveryAddress: true },
      blockers: prev.blockers.filter((b) => b !== "GUEST_DELIVERY_INVALID" && b !== "MISSING_SHIPPING_ADDRESS"),
    }))
  }

  const cartUrl = localePath(locale, "/cart")
  const catalogUrl = localePath(locale, "/products")

  return (
    <div className="shell lux-checkout-page" id="main-content">
      {/* Header & Breadcrumb */}
      <div className="lux-checkout-header">
        <div>
          <Link href={cartUrl} className="lux-back-link">
            <span aria-hidden="true">{locale === "en" ? "←" : "→"}</span>{" "}
            {dict.checkout.backToCart}
          </Link>
          <h1 className="lux-checkout-title">{dict.checkout.title}</h1>
          <p className="lux-checkout-subtitle">{dict.checkout.subtitle}</p>
        </div>
        <div>
          {isQaMode ? (
            <span className="lux-checkout-badge lux-qa-badge" role="status">
              {dict.checkout.qaBadge}
            </span>
          ) : (
            <span className="lux-checkout-badge" role="status">
              {dict.checkout.previewBadge}
            </span>
          )}
        </div>
      </div>

      {/* QA Success Simulation Alert */}
      {qaSimulatedSuccess ? (
        <div className="notice notice-success lux-qa-alert" role="status">
          <strong>✓ {dict.checkout.qaSuccessTitle}</strong>
          <p>{dict.checkout.qaSuccessNotice}</p>
        </div>
      ) : null}

      {/* Normal / Non-QA Mode Informational Notice */}
      {!isQaMode ? (
        <div className="notice notice-info lux-disabled-alert" role="note">
          <strong>🔒 {dict.checkout.disabledNotice}</strong>
          <p>{dict.cart.checkoutDisabledNotice}</p>
        </div>
      ) : null}

      {!hasItems ? (
        <div className="lux-checkout-empty" role="status">
          <div className="lux-cart-empty-icon" aria-hidden="true">
            📦
          </div>
          <h2>{dict.checkout.emptyCartNotice}</h2>
          <div className="lux-cart-empty-actions">
            <Link href={catalogUrl} className="button button-primary">
              {dict.checkout.backToShop}{" "}
              <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="lux-checkout-grid">
          {/* Guest Information Form */}
          <section className="lux-checkout-form-section" aria-labelledby="guest-info-heading">
            <h2 id="guest-info-heading" className="lux-section-heading">
              {dict.checkout.guestInfoHeading}
            </h2>

            <form
              className="lux-checkout-form"
              onSubmit={handleQaSimulate}
              noValidate
              autoComplete="off"
            >
              {/* First Name & Last Name (Unambiguous Name Separation) */}
              <div className="lux-form-row">
                <div className="lux-form-group">
                  <label htmlFor="firstName" className="lux-label">
                    {dict.checkout.firstNameLabel} <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    className={`lux-input ${errors.firstName ? "lux-input-error" : ""}`}
                    placeholder={dict.checkout.firstNamePlaceholder}
                    value={formData.firstName}
                    onChange={(e) => handleFieldChange("firstName", e.target.value)}
                    aria-required="true"
                    aria-invalid={Boolean(errors.firstName)}
                    aria-describedby={errors.firstName ? "firstName-error" : undefined}
                  />
                  {errors.firstName ? (
                    <span id="firstName-error" className="lux-field-error" role="alert">
                      {errors.firstName}
                    </span>
                  ) : null}
                </div>

                <div className="lux-form-group">
                  <label htmlFor="lastName" className="lux-label">
                    {dict.checkout.lastNameLabel} <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    className={`lux-input ${errors.lastName ? "lux-input-error" : ""}`}
                    placeholder={dict.checkout.lastNamePlaceholder}
                    value={formData.lastName}
                    onChange={(e) => handleFieldChange("lastName", e.target.value)}
                    aria-required="true"
                    aria-invalid={Boolean(errors.lastName)}
                    aria-describedby={errors.lastName ? "lastName-error" : undefined}
                  />
                  {errors.lastName ? (
                    <span id="lastName-error" className="lux-field-error" role="alert">
                      {errors.lastName}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Email Address */}
              <div className="lux-form-group">
                <label htmlFor="email" className="lux-label">
                  {dict.checkout.emailLabel} <span aria-hidden="true">*</span>
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  dir="ltr"
                  className={`lux-input ${errors.email ? "lux-input-error" : ""}`}
                  placeholder={dict.checkout.emailPlaceholder}
                  value={formData.email}
                  onChange={(e) => handleFieldChange("email", e.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
                {errors.email ? (
                  <span id="email-error" className="lux-field-error" role="alert">
                    {errors.email}
                  </span>
                ) : null}
              </div>

              {/* Egyptian Mobile Phone */}
              <div className="lux-form-group">
                <label htmlFor="phone" className="lux-label">
                  {dict.checkout.phoneLabel} <span aria-hidden="true">*</span>
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  dir="ltr"
                  className={`lux-input ${errors.phone ? "lux-input-error" : ""}`}
                  placeholder={dict.checkout.phonePlaceholder}
                  value={formData.phone}
                  onChange={(e) => handleFieldChange("phone", e.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                />
                {errors.phone ? (
                  <span id="phone-error" className="lux-field-error" role="alert">
                    {errors.phone}
                  </span>
                ) : null}
              </div>

              {/* Governorate Selection */}
              <div className="lux-form-group">
                <label htmlFor="governorate" className="lux-label">
                  {dict.checkout.governorateLabel} <span aria-hidden="true">*</span>
                </label>
                <select
                  id="governorate"
                  name="governorate"
                  className={`lux-select ${errors.governorate ? "lux-input-error" : ""}`}
                  value={formData.governorate}
                  onChange={(e) => handleFieldChange("governorate", e.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(errors.governorate)}
                  aria-describedby={errors.governorate ? "governorate-error" : undefined}
                >
                  <option value="">{dict.checkout.selectGovernorate}</option>
                  {EGYPTIAN_GOVERNORATES.map((gov) => (
                    <option key={gov.code} value={gov.code}>
                      {locale === "ar" ? gov.nameAr : gov.nameEn}
                    </option>
                  ))}
                </select>
                {errors.governorate ? (
                  <span id="governorate-error" className="lux-field-error" role="alert">
                    {errors.governorate}
                  </span>
                ) : null}
              </div>

              {/* City / District */}
              <div className="lux-form-group">
                <label htmlFor="city" className="lux-label">
                  {dict.checkout.cityLabel} <span aria-hidden="true">*</span>
                </label>
                <input
                  id="city"
                  name="city"
                  type="text"
                  className={`lux-input ${errors.city ? "lux-input-error" : ""}`}
                  placeholder={dict.checkout.cityPlaceholder}
                  value={formData.city}
                  onChange={(e) => handleFieldChange("city", e.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(errors.city)}
                  aria-describedby={errors.city ? "city-error" : undefined}
                />
                {errors.city ? (
                  <span id="city-error" className="lux-field-error" role="alert">
                    {errors.city}
                  </span>
                ) : null}
              </div>

              {/* Detailed Delivery Address */}
              <div className="lux-form-group">
                <label htmlFor="address" className="lux-label">
                  {dict.checkout.addressLabel} <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id="address"
                  name="address"
                  rows={3}
                  className={`lux-textarea ${errors.address ? "lux-input-error" : ""}`}
                  placeholder={dict.checkout.addressPlaceholder}
                  value={formData.address}
                  onChange={(e) => handleFieldChange("address", e.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(errors.address)}
                  aria-describedby={errors.address ? "address-error" : undefined}
                />
                {errors.address ? (
                  <span id="address-error" className="lux-field-error" role="alert">
                    {errors.address}
                  </span>
                ) : null}
              </div>

              {/* Delivery Notes (Optional) */}
              <div className="lux-form-group">
                <label htmlFor="notes" className="lux-label">
                  {dict.checkout.notesLabel}
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  className="lux-textarea"
                  placeholder={dict.checkout.notesPlaceholder}
                  value={formData.notes}
                  onChange={(e) => handleFieldChange("notes", e.target.value)}
                />
              </div>

              {/* Actions & Simulation Control */}
              <div className="lux-checkout-actions">
                {isQaMode ? (
                  <button type="submit" className="button button-primary lux-checkout-submit">
                    {dict.checkout.qaSimulateButton}
                  </button>
                ) : (
                  <div className="lux-disabled-submit-wrap">
                    <button
                      type="button"
                      disabled
                      className="button button-disabled lux-checkout-submit"
                      aria-disabled="true"
                    >
                      <span aria-hidden="true">🔒</span> {dict.checkout.disabledSubmitButton}
                    </button>
                    <p className="lux-checkout-disabled-hint">{dict.checkout.disabledNotice}</p>
                  </div>
                )}
              </div>
            </form>
          </section>

          {/* Cart & Order Summary + Read-Only Checkout Readiness */}
          <aside className="lux-checkout-sidebar" aria-label={dict.checkout.orderSummaryHeading}>
            {/* Cart Summary */}
            <div className="lux-checkout-summary" aria-labelledby="order-summary-heading">
              <h2 id="order-summary-heading" className="lux-section-heading">
                {dict.checkout.orderSummaryHeading}
              </h2>

              {/* Line items list */}
              <ul className="lux-checkout-items" aria-label={dict.checkout.orderSummaryHeading}>
                {items.map((item, index) => {
                  const lineTotalFormatted = formatEgpAmount(item.total, locale)
                  return (
                    <li key={item.id || `item-${index}`} className="lux-checkout-item">
                      <div className="lux-checkout-item-info">
                        <strong className="lux-checkout-item-title">
                          {item.title || dict.product.variantFallback(index + 1)}
                        </strong>
                        <span className="lux-checkout-item-meta">
                          {dict.cart.quantityHeader}: {item.quantity} · {dict.cart.variantLabel}:{" "}
                          <bdi dir="ltr">{item.variant_id}</bdi>
                        </span>
                      </div>
                      <div className="lux-checkout-item-total">
                        <strong>{lineTotalFormatted ?? dict.product.priceUnavailable}</strong>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Subtotal */}
              <div className="lux-cart-summary-row">
                <span>{dict.checkout.itemsSubtotal}</span>
                <strong>
                  {formatEgpAmount(activeCart?.subtotal, locale) ?? dict.product.priceUnavailable}
                </strong>
              </div>

              {/* Shipping / Delivery Status */}
              <div className="lux-cart-summary-row lux-shipping-row">
                <span>{dict.checkout.shippingHeader}</span>
                <span className="lux-pending-badge" role="note">
                  {dict.checkout.shippingPending}
                </span>
              </div>
              <p className="lux-shipping-notice">{dict.checkout.shippingNotice}</p>

              {/* Payable Total */}
              <div className="lux-cart-summary-row lux-cart-summary-total">
                <span>{dict.cart.totalLabel}</span>
                <strong className="lux-cart-grand-total">
                  {formatEgpAmount(activeCart?.subtotal, locale) ?? dict.product.priceUnavailable}*
                </strong>
              </div>
              <p className="lux-total-notice">*{dict.checkout.payableTotalNotice}</p>

              {/* Authoritative Medusa Notice */}
              <div className="lux-cart-notices">
                <p className="lux-cart-notice-authoritative">{dict.cart.authoritativeNotice}</p>
              </div>
            </div>

            {/* Priority 3: Read-Only Checkout Readiness Display */}
            <div className="lux-readiness-card" aria-labelledby="readiness-heading">
              <div className="lux-readiness-header">
                <h3 id="readiness-heading" className="lux-readiness-title">
                  {dict.checkout.readinessHeading}
                </h3>
                <span className="lux-readiness-badge">
                  {isQaMode ? dict.checkout.readinessBadgeQa : dict.checkout.readinessBadgeLive}
                </span>
              </div>

              <div className="lux-readiness-status-row">
                <span>{dict.checkout.ownershipLabel}:</span>
                <span className="lux-status-tag lux-status-blocked">{dict.checkout.statusBlocked}</span>
              </div>

              <ul className="lux-readiness-checklist" aria-label={dict.checkout.readinessHeading}>
                <li className="lux-readiness-item">
                  <span>{dict.checkout.deliveryAddressLabel}</span>
                  <span
                    className={`lux-status-tag ${
                      readinessState.readiness.deliveryAddress
                        ? "lux-status-met"
                        : "lux-status-pending"
                    }`}
                  >
                    {readinessState.readiness.deliveryAddress
                      ? dict.checkout.statusMet
                      : dict.checkout.statusPending}
                  </span>
                </li>
                <li className="lux-readiness-item">
                  <span>{dict.checkout.shippingMethodLabel}</span>
                  <span className="lux-status-tag lux-status-pending">
                    {dict.checkout.statusPending}
                  </span>
                </li>
                <li className="lux-readiness-item">
                  <span>{dict.checkout.shippingPriceLabel}</span>
                  <span className="lux-status-tag lux-status-pending">
                    {dict.checkout.statusPending}
                  </span>
                </li>
                <li className="lux-readiness-item">
                  <span>{dict.checkout.payableTotalLabel}</span>
                  <span
                    className={`lux-status-tag ${
                      readinessState.readiness.payableTotal
                        ? "lux-status-met"
                        : "lux-status-pending"
                    }`}
                  >
                    {readinessState.readiness.payableTotal
                      ? dict.checkout.statusMet
                      : dict.checkout.statusPending}
                  </span>
                </li>
              </ul>

              {/* Active Central Blockers Explanations */}
              {readinessState.blockers.length > 0 ? (
                <div className="lux-blockers-container">
                  <strong className="lux-blockers-label">{dict.checkout.statusBlocked}:</strong>
                  <ul className="lux-blockers-list">
                    {readinessState.blockers.map((code) => {
                      const msg = dict.checkout.blockers[code] ?? code
                      return <li key={code}>{msg}</li>
                    })}
                  </ul>
                </div>
              ) : null}

              <p className="lux-readiness-notice">{dict.checkout.readinessNotice}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { getDictionary, localePath, type Locale } from "../lib/i18n"
import { formatEgpAmount } from "../lib/medusa"
import type { SanitizedCart } from "../lib/cart-types"
import { SYNTHETIC_CART_PREVIEW_FIXTURE } from "../lib/cart-types"

export interface CartViewProps {
  locale: Locale
  initialCart?: SanitizedCart | null
  errorCode?: string | null
  allowSyntheticPreview?: boolean
}

/**
 * Bilingual, accessible Cart View Component (Phase 4 MVP).
 *
 * Designed to consume authoritative `SanitizedCart` data from Medusa:
 * - Empty cart state with return-to-shopping navigation.
 * - Populated cart state with authoritative unit prices and Medusa totals.
 * - Clear nonproduction preview badges and system notices.
 * - Strictly read-only: does not execute live checkout or payment transactions.
 */
export function CartView({ locale, initialCart = null, errorCode = null, allowSyntheticPreview = false }: CartViewProps) {
  const dict = getDictionary(locale)
  const searchParams = useSearchParams()
  const isPreviewParam = allowSyntheticPreview && searchParams?.get("preview") === "sample"

  // Use synthetic fixture in nonproduction preview mode when no live cart is provided
  const activeCart: SanitizedCart | null =
    initialCart ?? (isPreviewParam ? SYNTHETIC_CART_PREVIEW_FIXTURE : null)

  const items = activeCart?.items ?? []
  const hasItems = items.length > 0
  const catalogUrl = localePath(locale, "/products")

  return (
    <div className="shell lux-cart-page" id="main-content">
      <div className="lux-cart-header">
        <div>
          <span className="lux-eyebrow">{dict.brand.name}</span>
          <h1 className="lux-cart-title">{dict.cart.title}</h1>
        </div>
        <span className="lux-cart-badge">{dict.cart.previewBadge}</span>
      </div>

      {errorCode ? (
        <div className="notice notice-error" role="alert">
          <strong>{dict.cart.errorTitle}</strong>
          <p>
            {errorCode === "CART_MUTATIONS_LOCKED" || errorCode === "cart_locked"
              ? dict.cart.lockedError
              : errorCode === "CART_ALREADY_COMPLETED" || errorCode === "cart_completed"
              ? dict.cart.completedError
              : errorCode === "LOCK_TIMEOUT" || errorCode === "lock_timeout"
              ? dict.cart.timeoutError
              : dict.cart.genericError}
          </p>
        </div>
      ) : null}

      {!hasItems ? (
        <div className="lux-cart-empty" role="status">
          <div className="lux-cart-empty-icon" aria-hidden="true">
            🛒
          </div>
          <h2>{dict.cart.emptyTitle}</h2>
          <p>{dict.cart.emptyMessage}</p>
          <div className="lux-cart-empty-actions">
            <Link href={catalogUrl} className="button button-primary">
              {dict.cart.continueShopping}{" "}
              <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
            </Link>
          </div>
          <p className="lux-cart-disclaimer">{dict.cart.nonProductionNotice}</p>
        </div>
      ) : (
        <div className="lux-cart-grid">
          <div className="lux-cart-items-container">
            <ul className="lux-cart-items" aria-label={dict.cart.title}>
              {items.map((item, index) => {
                const unitPriceFormatted = formatEgpAmount(item.unit_price, locale)
                const lineTotalFormatted = formatEgpAmount(item.total, locale)
                return (
                  <li key={item.id || `item-${index}`} className="lux-cart-item">
                    <div className="lux-cart-item-details">
                      <strong className="lux-cart-item-title">
                        {item.title || dict.product.variantFallback(index + 1)}
                      </strong>
                      <span className="lux-cart-item-variant">
                        {dict.cart.variantLabel}: <bdi dir="ltr">{item.variant_id}</bdi>
                      </span>
                      <div className="lux-cart-item-meta">
                        <span className="lux-cart-item-qty">
                          {dict.cart.quantityHeader}: {item.quantity}
                        </span>
                        {unitPriceFormatted ? (
                          <span className="lux-cart-item-price">
                            {dict.cart.unitPriceLabel}: {unitPriceFormatted}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="lux-cart-item-total">
                      <span className="lux-cart-subtotal-label">{dict.cart.subtotalLabel}</span>
                      <strong>{lineTotalFormatted ?? dict.product.priceUnavailable}</strong>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="lux-cart-navigation">
              <Link href={catalogUrl} className="button button-secondary">
                <span aria-hidden="true">{locale === "en" ? "←" : "→"}</span>{" "}
                {dict.cart.continueShopping}
              </Link>
            </div>
          </div>

          <aside className="lux-cart-summary" aria-label={dict.cart.totalHeader}>
            <h2>{dict.cart.totalHeader}</h2>

            <div className="lux-cart-summary-row">
              <span>{dict.cart.subtotalHeader}</span>
              <strong>
                {formatEgpAmount(activeCart?.subtotal, locale) ?? dict.product.priceUnavailable}
              </strong>
            </div>

            <div className="lux-cart-summary-row lux-cart-summary-total">
              <span>{dict.cart.totalLabel}</span>
              <strong className="lux-cart-grand-total">
                {formatEgpAmount(activeCart?.total, locale) ?? dict.product.priceUnavailable}
              </strong>
            </div>

            <div className="lux-cart-notices">
              <p className="lux-cart-notice-authoritative">
                {dict.cart.authoritativeNotice}
              </p>
              <div className="lux-cart-checkout-disabled" role="note">
                <span className="lux-cart-disabled-icon" aria-hidden="true">
                  🔒
                </span>
                <span>{dict.cart.checkoutDisabledNotice}</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

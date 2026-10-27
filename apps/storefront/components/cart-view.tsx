"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { getDictionary, localePath, type Locale } from "../lib/i18n"
import { formatEgpAmount } from "../lib/medusa"
import type { SanitizedCart } from "../lib/cart-types"
import { SYNTHETIC_CART_PREVIEW_FIXTURE } from "../lib/cart-types"
import { newCartRequestId, requestCartBff, type CartBffSnapshot } from "../lib/cart-bff"

export interface CartViewProps {
  locale: Locale
  initialCart?: SanitizedCart | null
  errorCode?: string | null
  allowSyntheticPreview?: boolean
}

/**
 * Bilingual, accessible Cart View Component (Phase 4 MVP).
 *
 * Designed to consume authoritative Agent 2 guest-cart snapshots:
 * - Empty cart state with return-to-shopping navigation.
 * - Populated cart state with authoritative unit prices and Medusa totals.
 * - Clear nonproduction preview badges and system notices.
 * - Updates and removes lines through versioned guest-session BFF operations.
 * - Does not execute checkout or payment transactions.
 */
export function CartView({ locale, initialCart = null, errorCode = null, allowSyntheticPreview = false }: CartViewProps) {
  const dict = getDictionary(locale)
  const searchParams = useSearchParams()
  const [serverCart, setServerCart] = useState<CartBffSnapshot | null>(null)
  const [cartReadComplete, setCartReadComplete] = useState(false)
  const [mutationError, setMutationError] = useState(false)
  const isPreviewParam = allowSyntheticPreview && searchParams?.get("preview") === "sample"

  // Use synthetic fixture in nonproduction preview mode when no live cart is provided
  const activeCart: SanitizedCart | null =
    initialCart ?? (isPreviewParam ? SYNTHETIC_CART_PREVIEW_FIXTURE : null)

  useEffect(() => {
    if (isPreviewParam || initialCart) { setCartReadComplete(true); return }
    let active = true
    void requestCartBff({ operation: "read", requestId: newCartRequestId() }).then((result) => {
      if (!active) return
      if (result.success && result.data.ok) setServerCart(result.data.cart)
      setMutationError(!result.success)
      setCartReadComplete(true)
    })
    return () => { active = false }
  }, [initialCart, isPreviewParam])

  const mutateItem = async (lineItemId: string, quantity?: number) => {
    if (!serverCart) return
    setMutationError(false)
    const result = await requestCartBff(quantity === undefined
      ? { operation: "remove_item", requestId: newCartRequestId(), expectedVersion: serverCart.version, lineItemId }
      : { operation: "update_item", requestId: newCartRequestId(), expectedVersion: serverCart.version, lineItemId, quantity })
    if (result.success && result.data.ok && result.data.cart) setServerCart(result.data.cart)
    else setMutationError(true)
  }

  const items = serverCart?.items.map((line) => ({
    id: line.lineItemId, title: line.title, variant_id: line.variantId, quantity: line.quantity,
    unit_price: line.unitPrice.amount, total: line.total.amount, availability: line.availability,
  })) ?? activeCart?.items ?? []
  const hasItems = items.length > 0
  const catalogUrl = localePath(locale, "/products")
  const checkoutUrl = localePath(locale, "/checkout")

  return (
    <div className="shell lux-cart-page" id="main-content">
      <div className="lux-cart-header">
        <div>
          <span className="lux-eyebrow">{dict.brand.name}</span>
          <h1 className="lux-cart-title">{dict.cart.title}</h1>
        </div>
        {isPreviewParam ? <span className="lux-cart-badge">{dict.cart.previewBadge}</span> : null}
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
      {mutationError ? <div className="notice notice-error" role="alert">{dict.cart.cartServiceUnavailable}</div> : null}

      {!cartReadComplete && !hasItems ? (
        <div className="lux-cart-empty" role="status" aria-live="polite">{dict.cart.loadingCart}</div>
      ) : !hasItems ? (
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
                const unitPriceFormatted = formatCartAmount(item.unit_price, locale)
                const lineTotalFormatted = formatCartAmount(item.total, locale)
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
                        {"availability" in item ? (
                          <span className="lux-cart-item-qty" role="status">
                            {item.availability === "available" ? dict.availability.available.label : item.availability === "unavailable" ? dict.availability.unavailable.label : dict.availability.unknown.label}
                          </span>
                        ) : null}
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
                    {serverCart ? (
                      <div className="lux-cart-item-actions" aria-label={dict.cart.updateCart}>
                        <button type="button" className="lux-qty-btn" aria-label={dict.cart.decreaseQuantity}
                          disabled={item.quantity <= 1} onClick={() => mutateItem(item.id, item.quantity - 1)}>−</button>
                        <button type="button" className="lux-qty-btn" aria-label={dict.cart.increaseQuantity}
                          disabled={item.quantity >= 100} onClick={() => mutateItem(item.id, item.quantity + 1)}>+</button>
                        <button type="button" className="button button-secondary" onClick={() => mutateItem(item.id)}>{dict.cart.removeItem}</button>
                      </div>
                    ) : null}
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
                {serverCart ? formatCartAmount(serverCart.subtotal.amount, locale) : formatEgpAmount(activeCart?.subtotal, locale) ?? dict.product.priceUnavailable}
              </strong>
            </div>

            <div className="lux-cart-summary-row lux-cart-summary-total">
              <span>{dict.cart.totalLabel}</span>
              <strong className="lux-cart-grand-total">
                {serverCart?.shipping
                  ? formatCartAmount(serverCart.total.amount, locale) ?? dict.product.priceUnavailable
                  : isPreviewParam
                    ? formatEgpAmount(activeCart?.total, locale) ?? dict.product.priceUnavailable
                    : dict.product.priceUnavailable}
              </strong>
            </div>
            {!serverCart?.shipping && !isPreviewParam ? (
              <p className="lux-cart-notice-authoritative" role="note">{dict.cart.cartTotalUnavailable}</p>
            ) : null}

            <div className="lux-cart-actions">
              <Link
                href={checkoutUrl}
                className="button button-primary lux-cart-checkout-btn"
              >
                {dict.cart.goToCheckout}{" "}
                <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
              </Link>
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

function formatCartAmount(amount: number | string | null, locale: Locale): string | null {
  const value = typeof amount === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount) ? Number(amount) : amount
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(value)
}


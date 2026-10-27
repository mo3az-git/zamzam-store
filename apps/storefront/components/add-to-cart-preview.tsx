"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { getDictionary, localePath, type Locale } from "../lib/i18n"
import { newCartRequestId, requestCartBff, type CartBffBlocker } from "../lib/cart-bff"
import { resolveSelectedVariantId } from "../lib/medusa"

export interface AddToCartPreviewProps {
  variantId: string
  variantIds?: string[]
  locale: Locale
  bffEnabled?: boolean
}

/**
 * Cart action backed only by the same-origin server-owned guest-cart contract.
 * It stays disabled until the trusted server enables the mounted BFF route.
 * It cannot start checkout or payment.
 */
export function AddToCartPreview({ variantId, variantIds = [], locale, bffEnabled = false }: AddToCartPreviewProps) {
  const dict = getDictionary(locale)
  const searchParams = useSearchParams()

  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [cartError, setCartError] = useState<CartBffBlocker | "transport" | null>(null)
  const selectedVariantId = resolveSelectedVariantId(
    (variantIds.length ? variantIds : [variantId]).map((id) => ({ id })),
    searchParams?.get("variant")
  )

  const handleDecrement = () => {
    setQuantity((prev) => Math.max(1, prev - 1))
    setIsSuccess(false)
    setCartError(null)
  }

  const handleIncrement = () => {
    setQuantity((prev) => Math.min(100, prev + 1))
    setIsSuccess(false)
    setCartError(null)
  }

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (!Number.isNaN(val) && val >= 1 && val <= 100) {
      setQuantity(val)
      setIsSuccess(false)
      setCartError(null)
    }
  }

  const handleAddToCart = async () => {
    setCartError(null)
    setIsSubmitting(true)
    if (!bffEnabled) { setIsSubmitting(false); return }

    // Resolve only the cart associated with this browser's HttpOnly guest
    // session. No cart ID, owner, price, or stock data is accepted from UI.
    const read = await requestCartBff({ operation: "read", requestId: newCartRequestId() })
    let cart = read.success ? read.data.cart : null
    let failure: CartBffBlocker | "transport" = read.success ? read.data.blockers[0] ?? "CART_UNAVAILABLE" : "transport"
    if (!read.success) {
      setCartError("transport")
      setIsSubmitting(false)
      return
    }
    if (!cart && read.data.blockers.includes("CART_UNAVAILABLE")) {
      const created = await requestCartBff({ operation: "create", requestId: newCartRequestId() })
      cart = created.success && created.data.ok ? created.data.cart : null
      if (!cart) failure = created.success ? created.data.blockers[0] ?? "CART_UNAVAILABLE" : "transport"
    }
    if (!cart || !selectedVariantId) {
      setCartError(failure)
      setIsSubmitting(false)
      return
    }
    const result = await requestCartBff({ operation: "add_item", requestId: newCartRequestId(),
      expectedVersion: cart.version, variantId: selectedVariantId, quantity })
    if (!result.success || !result.data.ok || !result.data.cart) {
      setCartError(result.success ? result.data.blockers[0] ?? "UPSTREAM_UNAVAILABLE" : "transport")
      setIsSubmitting(false)
      return
    }
    setIsSuccess(true)
    setIsSubmitting(false)
  }

  const cartUrl = localePath(locale, "/cart")

  return (
    <div className="lux-cart-preview-box" role="region" aria-label={dict.cart.addToCartButton}>
      <div className="lux-cart-preview-row">
        <div className="lux-qty-stepper">
          <button
            type="button"
            className="lux-qty-btn"
            onClick={handleDecrement}
            aria-label={dict.cart.decreaseQuantity}
            disabled={quantity <= 1 || isSubmitting || !bffEnabled}
          >
            -
          </button>
          <input
            type="number"
            className="lux-qty-input"
            value={quantity}
            onChange={handleQuantityChange}
            min={1}
            max={100}
            aria-label={dict.cart.quantityHeader}
            disabled={isSubmitting || !bffEnabled}
          />
          <button
            type="button"
            className="lux-qty-btn"
            onClick={handleIncrement}
            aria-label={dict.cart.increaseQuantity}
            disabled={quantity >= 100 || isSubmitting || !bffEnabled}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={handleAddToCart}
          disabled={isSubmitting || !selectedVariantId || !bffEnabled}
        >
          {isSubmitting ? dict.cart.addingToCart : dict.cart.addToCartButton}
        </button>
      </div>

      {isSuccess && bffEnabled ? (
        <div className="notice notice-success" role="status">
          <p>{dict.cart.addedSuccess}</p>
          <Link href={cartUrl} className="subtle-link">
            {dict.cart.title} <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
          </Link>
        </div>
      ) : null}

      {cartError ? <p className="notice notice-error" role="alert">{cartError === "CART_UNAVAILABLE"
        ? dict.cart.sessionOrCartUnavailable
        : cartError === "CART_VERSION_CONFLICT"
          ? dict.cart.cartVersionConflict
        : cartError === "INVENTORY_UNAVAILABLE"
          ? dict.cart.insufficientStock
          : dict.cart.cartServiceUnavailable}</p> : null}
      {!bffEnabled ? <p className="lux-cart-disclaimer">{dict.cart.cartServiceUnavailable}</p> : null}
    </div>
  )
}

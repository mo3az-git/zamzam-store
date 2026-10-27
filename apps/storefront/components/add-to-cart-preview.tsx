"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { getDictionary, localePath, type Locale } from "../lib/i18n"
import { newCartRequestId, requestCartBff } from "../lib/cart-bff"
import { resolveSelectedVariantId } from "../lib/medusa"

export interface AddToCartPreviewProps {
  variantId: string
  variantIds?: string[]
  locale: Locale
  allowSyntheticPreview?: boolean
}

/**
 * Cart action backed only by the same-origin server-owned guest-cart contract.
 * The isolated fake-success preview remains available only when the server
 * explicitly permits preview mode and the URL opts into `?preview=cart`.
 * Neither path can start checkout or payment.
 */
export function AddToCartPreview({ variantId, variantIds = [], locale, allowSyntheticPreview = false }: AddToCartPreviewProps) {
  const dict = getDictionary(locale)
  const searchParams = useSearchParams()
  const isPreview = allowSyntheticPreview && searchParams?.get("preview") === "cart"

  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [hasError, setHasError] = useState(false)
  const selectedVariantId = resolveSelectedVariantId(
    (variantIds.length ? variantIds : [variantId]).map((id) => ({ id })),
    searchParams?.get("variant")
  )

  const handleDecrement = () => {
    setQuantity((prev) => Math.max(1, prev - 1))
    setIsSuccess(false)
    setHasError(false)
  }

  const handleIncrement = () => {
    setQuantity((prev) => Math.min(100, prev + 1))
    setIsSuccess(false)
    setHasError(false)
  }

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (!Number.isNaN(val) && val >= 1 && val <= 100) {
      setQuantity(val)
      setIsSuccess(false)
      setHasError(false)
    }
  }

  const handleAddToCart = async () => {
    setHasError(false)
    setIsSubmitting(true)
    if (isPreview) {
      setTimeout(() => {
        setIsSubmitting(false)
        setIsSuccess(true)
      }, 250)
      return
    }

    // Resolve only the cart associated with this browser's HttpOnly guest
    // session. No cart ID, owner, price, or stock data is accepted from UI.
    const read = await requestCartBff({ operation: "read", requestId: newCartRequestId() })
    let cart = read.success ? read.data.cart : null
    if (!read.success) {
      setHasError(true)
      setIsSubmitting(false)
      return
    }
    if (!cart && read.data.blockers.includes("CART_UNAVAILABLE")) {
      const created = await requestCartBff({ operation: "create", requestId: newCartRequestId() })
      cart = created.success && created.data.ok ? created.data.cart : null
    }
    if (!cart || !selectedVariantId) {
      setHasError(true)
      setIsSubmitting(false)
      return
    }
    const result = await requestCartBff({ operation: "add_item", requestId: newCartRequestId(),
      expectedVersion: cart.version, variantId: selectedVariantId, quantity })
    if (!result.success || !result.data.ok || !result.data.cart) {
      setHasError(true)
      setIsSubmitting(false)
      return
    }
    setIsSuccess(true)
    setIsSubmitting(false)
  }

  const cartUrl = localePath(locale, isPreview ? "/cart?preview=sample" : "/cart")

  return (
    <div className="lux-cart-preview-box" role="region" aria-label={isPreview ? dict.cart.previewBadge : dict.cart.addToCartButton}>
      {isPreview ? <span className="lux-cart-badge">{dict.cart.previewBadge}</span> : null}
      <div className="lux-cart-preview-row">
        <div className="lux-qty-stepper">
          <button
            type="button"
            className="lux-qty-btn"
            onClick={handleDecrement}
            aria-label={dict.cart.decreaseQuantity}
            disabled={quantity <= 1 || isSubmitting}
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
            disabled={isSubmitting}
          />
          <button
            type="button"
            className="lux-qty-btn"
            onClick={handleIncrement}
            aria-label={dict.cart.increaseQuantity}
            disabled={quantity >= 100 || isSubmitting}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={handleAddToCart}
          disabled={isSubmitting || !selectedVariantId}
        >
          {isSubmitting ? dict.cart.addingToCart : dict.cart.addToCartButton}
        </button>
      </div>

      {isSuccess ? (
        <div className="notice notice-success" role="status">
          <p>{dict.cart.addedSuccess}</p>
          <Link href={cartUrl} className="subtle-link">
            {dict.cart.title} <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
          </Link>
        </div>
      ) : null}

      {hasError ? <p className="notice notice-error" role="alert">{dict.cart.cartServiceUnavailable}</p> : null}
      {isPreview ? <p className="lux-cart-disclaimer">{dict.cart.nonProductionNotice}</p> : null}
    </div>
  )
}


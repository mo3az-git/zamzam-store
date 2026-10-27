"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { getDictionary, localePath, type Locale } from "../lib/i18n"

export interface AddToCartPreviewProps {
  variantId: string
  locale: Locale
  allowSyntheticPreview?: boolean
}

/**
 * Isolated Nonproduction Add-to-Cart Preview Control (Phase 4 MVP).
 *
 * Safety requirement:
 * The customer-facing action must remain disabled and hidden by default.
 * Interactive testing is only activated through an explicit nonproduction
 * preview query parameter (`?preview=cart`).
 *
 * Does NOT invoke any real backend mutation, cart creation, or checkout.
 */
export function AddToCartPreview({ variantId, locale, allowSyntheticPreview = false }: AddToCartPreviewProps) {
  const dict = getDictionary(locale)
  const searchParams = useSearchParams()
  const isPreview = allowSyntheticPreview && searchParams?.get("preview") === "cart"

  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // Customer-facing default: keep purchasing actions hidden
  if (!isPreview) {
    return null
  }

  const handleDecrement = () => {
    setQuantity((prev) => Math.max(1, prev - 1))
    setIsSuccess(false)
  }

  const handleIncrement = () => {
    setQuantity((prev) => Math.min(100, prev + 1))
    setIsSuccess(false)
  }

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (!Number.isNaN(val) && val >= 1 && val <= 100) {
      setQuantity(val)
      setIsSuccess(false)
    }
  }

  const handlePreviewSubmit = () => {
    setIsSubmitting(true)
    setTimeout(() => {
      setIsSubmitting(false)
      setIsSuccess(true)
    }, 250)
  }

  const cartUrl = localePath(locale, "/cart?preview=sample")

  return (
    <div className="lux-cart-preview-box" role="region" aria-label={dict.cart.previewBadge}>
      <span className="lux-cart-badge">{dict.cart.previewBadge}</span>
      <div className="lux-cart-preview-row">
        <div className="lux-qty-stepper">
          <button
            type="button"
            className="lux-qty-btn"
            onClick={handleDecrement}
            aria-label="Decrease quantity"
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
            aria-label="Increase quantity"
            disabled={quantity >= 100 || isSubmitting}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={handlePreviewSubmit}
          disabled={isSubmitting || !variantId}
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

      <p className="lux-cart-disclaimer">{dict.cart.nonProductionNotice}</p>
    </div>
  )
}

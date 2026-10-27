"use client"

import { useState } from "react"
import { formatVariantPrice, type StoreVariant } from "../lib/medusa"
import { getDictionary, type Locale } from "../lib/i18n"

/** Catalog-only variant selector. Never treats displayed price as checkout authority. */
export function VariantSelector({
  variants,
  locale = "ar",
}: {
  variants: StoreVariant[]
  locale?: Locale
}) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "")
  const dict = getDictionary(locale)
  const chosen = variants.find((variant) => variant.id === selectedId) ?? variants[0]
  const price = chosen ? formatVariantPrice(chosen, locale) : null

  if (!chosen) {
    return (
      <div className="detail-price" role="status">
        {dict.product.priceUnavailable}
      </div>
    )
  }

  return (
    <section className="detail-variant-picker" aria-label={dict.product.kicker}>
      <label className="detail-variant-label" htmlFor="product-variant">
        {variants.length > 1
          ? dict.product.selectVariantMultiple
          : dict.product.selectVariantSingle}
      </label>
      {variants.length > 1 ? (
        <select
          className="detail-variant-select"
          id="product-variant"
          value={chosen.id}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {variants.map((variant, index) => (
            <option key={variant.id} value={variant.id}>
              {variant.title?.trim() || dict.product.variantFallback(index)}
            </option>
          ))}
        </select>
      ) : (
        <p className="detail-variant-name">
          {chosen.title?.trim() || dict.product.defaultVariant}
        </p>
      )}
      <div aria-live="polite" aria-atomic="true">
        <div className="detail-price">
          {price ?? dict.product.priceUnavailable}
        </div>
        {chosen.sku?.trim() ? (
          <p className="detail-sku">
            {dict.product.skuLabel}: <bdi dir="ltr">{chosen.sku.trim()}</bdi>
          </p>
        ) : null}
        {!price ? (
          <p className="detail-variant-warning">{dict.product.priceNotice}</p>
        ) : null}
      </div>
      <p className="detail-variant-notice">{dict.product.orderNoticeBody}</p>
    </section>
  )
}

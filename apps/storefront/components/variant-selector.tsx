"use client"

import { useState } from "react"
import { getDictionary, type Locale } from "../lib/i18n"
import { formatVariantPrice, type StoreVariant } from "../lib/medusa"
import { AvailabilityDisplay } from "./availability-display"

/** Catalog-only variant selector. Never treats a displayed price as checkout authority. */
export function VariantSelector({
  variants,
  locale,
  availabilityByVariant,
}: {
  variants: StoreVariant[]
  locale: Locale
  /**
   * Optional authoritative availability status per variant id.
   * Defaults safely to "unknown" when not provided or unverified.
   */
  availabilityByVariant?: Record<string, unknown>
}) {
  const dict = getDictionary(locale)
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "")
  const chosen = variants.find((variant) => variant.id === selectedId) ?? variants[0]
  const price = chosen ? formatVariantPrice(chosen, locale) : null
  const sku = chosen?.sku?.trim()
  const chosenAvailability = chosen ? availabilityByVariant?.[chosen.id] : undefined

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
          ? dict.product.variantLabelMultiple
          : dict.product.variantLabelSingle}
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
              {variant.title?.trim() || dict.product.variantFallback(index + 1)}
            </option>
          ))}
        </select>
      ) : (
        <p className="detail-variant-name">
          {chosen.title?.trim() || dict.product.variantPrimary}
        </p>
      )}
      <div aria-live="polite" aria-atomic="true">
        <div className="detail-price">{price ?? dict.product.variantPriceUnavailable}</div>
        {sku ? (
          <p className="detail-sku">
            {dict.product.skuLabel} <bdi dir="ltr">{sku}</bdi>
          </p>
        ) : null}
        {!price ? <p className="detail-variant-warning">{dict.product.variantWarning}</p> : null}
      </div>
      <AvailabilityDisplay status={chosenAvailability} locale={locale} />
      <p className="detail-variant-notice">{dict.product.variantNotice}</p>
    </section>
  )
}

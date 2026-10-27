"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { getDictionary, type Locale } from "../lib/i18n"
import {
  formatVariantPrice,
  resolveSelectedVariantId,
  type StoreVariant,
} from "../lib/medusa"
import { AvailabilityDisplay } from "./availability-display"

/**
 * Catalog-only variant selector (DEF-04).
 *
 * Synchronizes the chosen variant with the `?variant=<id>` URL search parameter.
 * Strictly validates that the variant ID belongs to the product.
 * Preserves other search parameters and never treats a selected variant
 * as inventory claim or checkout authority.
 */
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
  const searchParams = useSearchParams()

  const initialVariantId = resolveSelectedVariantId(
    variants,
    searchParams?.get("variant")
  )
  const [selectedId, setSelectedId] = useState(initialVariantId)

  // React to URL navigation changes (e.g. browser back/forward)
  useEffect(() => {
    const fromUrl = searchParams?.get("variant")
    const validated = resolveSelectedVariantId(variants, fromUrl)
    if (validated && validated !== selectedId) {
      setSelectedId(validated)
    }
  }, [searchParams, variants, selectedId])

  const chosen = variants.find((variant) => variant.id === selectedId) ?? variants[0]
  const price = chosen ? formatVariantPrice(chosen, locale) : null
  const sku = chosen?.sku?.trim()
  const chosenAvailability = chosen ? availabilityByVariant?.[chosen.id] : undefined

  const handleVariantChange = (newId: string) => {
    setSelectedId(newId)
    if (typeof window !== "undefined") {
      const currentUrl = new URL(window.location.href)
      currentUrl.searchParams.set("variant", newId)
      window.history.replaceState(null, "", currentUrl.toString())
      window.dispatchEvent(new Event("popstate"))
    }
  }

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
          onChange={(event) => handleVariantChange(event.target.value)}
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

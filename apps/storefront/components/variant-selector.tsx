"use client"

import { useState } from "react"
import { formatVariantPrice, type StoreVariant } from "../lib/medusa"

/** Catalog-only variant selector. Never treats displayed price as checkout authority. */
export function VariantSelector({ variants }: { variants: StoreVariant[] }) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "")
  const chosen = variants.find((variant) => variant.id === selectedId) ?? variants[0]
  const price = chosen ? formatVariantPrice(chosen) : null

  if (!chosen) {
    return <div className="detail-price" role="status">السعر غير متاح حاليًا</div>
  }

  return (
    <section className="detail-variant-picker" aria-label="خيارات المنتج">
      <label className="detail-variant-label" htmlFor="product-variant">
        {variants.length > 1 ? "اختر العبوة أو الخيار" : "العبوة المتاحة في الكتالوج"}
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
              {variant.title?.trim() || `الخيار ${index + 1}`}
            </option>
          ))}
        </select>
      ) : <p className="detail-variant-name">{chosen.title?.trim() || "الخيار الأساسي"}</p>}
      <div aria-live="polite" aria-atomic="true">
        <div className="detail-price">{price ?? "السعر غير متاح لهذا الخيار"}</div>
        {chosen.sku?.trim() ? (
          <p className="detail-sku">رمز المنتج (SKU): <bdi dir="ltr">{chosen.sku.trim()}</bdi></p>
        ) : null}
        {!price ? <p className="detail-variant-warning">لا يمكن تأكيد السعر لهذا الخيار من بيانات المتجر.</p> : null}
      </div>
      <p className="detail-variant-notice">هذه معلومات للعرض فقط؛ إتاحة الشراء تعتمد على التحقق من المخزون والدفع لاحقًا.</p>
    </section>
  )
}

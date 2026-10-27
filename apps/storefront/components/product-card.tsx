import Image from "next/image"
import Link from "next/link"
import { displayPrice, type StoreProduct } from "../lib/medusa"
import { getDictionary, type Locale } from "../lib/i18n"

export function ProductCard({
  product,
  locale = "ar",
}: {
  product: StoreProduct
  locale?: Locale
}) {
  const dict = getDictionary(locale)
  const isEn = locale === "en"
  const price = displayPrice(product, locale)
  const productHref = isEn
    ? `/en/products/${encodeURIComponent(product.handle)}`
    : `/products/${encodeURIComponent(product.handle)}`

  return (
    <article className="product-card">
      <Link
        href={productHref}
        className="product-image-link"
        aria-label={`${product.title}`}
      >
        {product.thumbnail ? (
          <Image
            className="product-photo"
            src={product.thumbnail}
            alt={product.title}
            width={480}
            height={480}
            unoptimized
          />
        ) : (
          <span className="product-placeholder" aria-hidden="true">
            {dict.brand.name}
          </span>
        )}
      </Link>
      <div className="product-info">
        <h3>
          <Link href={productHref}>{product.title}</Link>
        </h3>
        {product.subtitle ? (
          <p className="product-subtitle">{product.subtitle}</p>
        ) : null}
        <div className="product-card-bottom">
          <span className="product-price">
            {price ?? dict.product.priceUnavailable}
          </span>
          <Link className="product-view" href={productHref}>
            <span>{isEn ? "Details" : "التفاصيل"}</span>
            <span aria-hidden="true">{isEn ? "→" : "←"}</span>
          </Link>
        </div>
      </div>
    </article>
  )
}

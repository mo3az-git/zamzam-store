import Image from "next/image"
import Link from "next/link"
import { getDictionary, localePath, type Locale } from "../lib/i18n"
import { displayPrice, type StoreProduct } from "../lib/medusa"

export function ProductCard({ product, locale }: { product: StoreProduct; locale: Locale }) {
  const dict = getDictionary(locale)
  const price = displayPrice(product, locale)
  const href = `${localePath(locale, "/products")}/${encodeURIComponent(product.handle)}`

  return (
    <article className="product-card">
      <Link
        href={href}
        className="product-image-link"
        aria-label={`${dict.product.kicker}: ${product.title}`}
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
          <Link href={href}>{product.title}</Link>
        </h3>
        {product.subtitle ? <p className="product-subtitle">{product.subtitle}</p> : null}
        <div className="product-card-bottom">
          <span className="product-price">{price ?? dict.product.priceUnavailable}</span>
          <Link className="product-view" href={href}>
            {dict.product.detailsCta} <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
          </Link>
        </div>
      </div>
    </article>
  )
}

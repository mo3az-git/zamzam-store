import Image from "next/image"
import Link from "next/link"
import { displayPrice, type StoreProduct } from "../lib/medusa"

export function ProductCard({ product, index }: { product: StoreProduct; index?: number }) {
  const price = displayPrice(product)
  const link = `/products/${encodeURIComponent(product.handle)}`
  return (
    <article className="product-card">
      <Link href={link} className="product-image-link" aria-label={`عرض تفاصيل ${product.title}`}>
        <span className="product-index" aria-hidden="true">{String(index ?? 1).padStart(2, "0")} / Z</span>
        {product.thumbnail ? (
          <Image className="product-photo" src={product.thumbnail} alt={product.title} width={520} height={520} unoptimized />
        ) : (
          <span className="product-placeholder" aria-hidden="true"><span>ز</span><small>صورة غير متاحة</small></span>
        )}
        <span className="product-image-arrow" aria-hidden="true">↗</span>
      </Link>
      <div className="product-info">
        {product.subtitle ? <p className="product-subtitle">{product.subtitle}</p> : <p className="product-subtitle">من كتالوج زمزم ستور</p>}
        <h3><Link href={link}>{product.title}</Link></h3>
        <div className="product-card-bottom">
          <span className="product-price">{price ?? "السعر غير متاح"}</span>
          <Link className="product-view" href={link}>التفاصيل <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
    </article>
  )
}

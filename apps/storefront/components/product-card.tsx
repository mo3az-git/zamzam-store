import Image from "next/image"
import Link from "next/link"
import { displayPrice, type StoreProduct } from "../lib/medusa"

export function ProductCard({ product }: { product: StoreProduct }) {
  const price = displayPrice(product)
  return (
    <article className="product-card">
      <Link href={`/products/${encodeURIComponent(product.handle)}`} className="product-image-link" aria-label={`عرض تفاصيل ${product.title}`}>
        {product.thumbnail ? (
          <Image className="product-photo" src={product.thumbnail} alt={product.title} width={480} height={480} unoptimized />
        ) : (
          <span className="product-placeholder" aria-hidden="true">زمزم</span>
        )}
      </Link>
      <div className="product-info">
        <h3><Link href={`/products/${encodeURIComponent(product.handle)}`}>{product.title}</Link></h3>
        {product.subtitle ? <p className="product-subtitle">{product.subtitle}</p> : null}
        <div className="product-card-bottom">
          <span className="product-price">{price ?? "السعر غير متاح حاليًا"}</span>
          <Link className="product-view" href={`/products/${encodeURIComponent(product.handle)}`}>التفاصيل <span aria-hidden="true">←</span></Link>
        </div>
      </div>
    </article>
  )
}

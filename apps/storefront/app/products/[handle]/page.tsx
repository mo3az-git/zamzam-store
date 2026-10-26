import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { displayPrice, listStoreProducts, storeErrorMessage } from "../../../lib/medusa"

export const dynamic = "force-dynamic"

type ProductParams = { handle: string }

export async function generateMetadata({ params }: { params: Promise<ProductParams> }): Promise<Metadata> {
  const { handle } = await params
  const result = await listStoreProducts({ handle, limit: 1 })
  const product = result.products.find((item) => item.handle === handle)
  return {
    title: product ? `${product.title} | زمزم ستور` : "تفاصيل المنتج | زمزم ستور",
    description: product?.description?.slice(0, 160) || "تفاصيل المنتج في زمزم ستور",
  }
}

export default async function ProductPage({ params }: { params: Promise<ProductParams> }) {
  const { handle } = await params
  const result = await listStoreProducts({ handle, limit: 1 })
  if (result.error) return (
    <main className="shell detail-page" id="main-content">
      <Link href="/products" className="subtle-link">→ العودة للكتالوج</Link>
      <div className="notice" role="status"><strong>تعذر عرض المنتج</strong><p>{storeErrorMessage(result.error)}</p></div>
    </main>
  )

  const product = result.products.find((item) => item.handle === handle)
  if (!product) notFound()

  const images = [
    ...(product.thumbnail ? [product.thumbnail] : []),
    ...(product.images ?? []).map((item) => item.url)
  ].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
  const price = displayPrice(product)

  return (
    <main className="shell detail-page" id="main-content">
      <nav className="breadcrumbs" aria-label="مسار التنقل"><Link href="/">الرئيسية</Link><span>/</span><Link href="/products">المنتجات</Link><span>/</span><span>{product.title}</span></nav>
      <div className="detail-grid">
        <div className="detail-gallery">
          {images[0] ? <Image src={images[0]} alt={product.title} width={800} height={800} unoptimized className="detail-main-photo" /> : <div className="detail-no-photo">لا توجد صورة لهذا المنتج حاليًا</div>}
          {images.length > 1 ? <div className="detail-thumbs">{images.slice(1, 4).map((url) =>
            <Image key={url} src={url} alt={product.title} width={180} height={180} unoptimized />
          )}</div> : null}
        </div>
        <div className="detail-copy">
          <span className="kicker">تفاصيل المنتج</span>
          <h1>{product.title}</h1>
          {product.subtitle ? <p className="detail-subtitle">{product.subtitle}</p> : null}
          <div className="detail-price">{price ?? "السعر غير متاح حاليًا"}</div>
          {product.description ? <div className="detail-description"><h2>الوصف</h2><p>{product.description}</p></div> : null}
          {(product.variants?.length ?? 0) > 0 ? (
            <div className="detail-variants"><h2>الخيارات المدرجة</h2><ul>{product.variants!.map((variant) => <li key={variant.id}>{variant.title || "خيار المنتج"}</li>)}</ul></div>
          ) : null}
          <div className="availability-note">
            <strong>معلومات الطلب</strong>
            <p>تُعرض هنا معلومات الكتالوج فقط. ستتاح إمكانية إضافة المنتج إلى السلة عند اكتمال الربط بالتحقق من المخزون والدفع.</p>
          </div>
          <Link className="button button-secondary" href="/products">متابعة التسوق <span aria-hidden="true">←</span></Link>
        </div>
      </div>
    </main>
  )
}

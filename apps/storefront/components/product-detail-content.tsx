import Link from "next/link"
import { notFound } from "next/navigation"
import { listStoreProducts, storeErrorMessage } from "../lib/medusa"
import { VariantSelector } from "./variant-selector"
import { ProductGallery } from "./product-gallery"
import { getDictionary, type Locale } from "../lib/i18n"

export async function ProductDetailContent({
  handle,
  locale = "ar",
}: {
  handle: string
  locale?: Locale
}) {
  const dict = getDictionary(locale)
  const isEn = locale === "en"
  const homePath = isEn ? "/en" : "/"
  const productsPath = isEn ? "/en/products" : "/products"
  const arrowBack = isEn ? "←" : "→"
  const arrowNext = isEn ? "→" : "←"

  const result = await listStoreProducts({ handle, limit: 1 })

  if (result.error) {
    return (
      <main className="shell detail-page" id="main-content">
        <Link href={productsPath} className="subtle-link">
          <span aria-hidden="true">{arrowBack}</span> {dict.product.backToCatalog}
        </Link>
        <div className="notice" role="status">
          <strong>{isEn ? "Unable to display product" : "تعذر عرض المنتج"}</strong>
          <p>{storeErrorMessage(result.error, locale)}</p>
        </div>
      </main>
    )
  }

  const product = result.products.find((item) => item.handle === handle)
  if (!product) notFound()

  const images = [
    ...(product.thumbnail ? [product.thumbnail] : []),
    ...(product.images ?? []).map((item) => item.url),
  ].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)

  return (
    <main className="shell detail-page" id="main-content">
      <nav className="breadcrumbs" aria-label={isEn ? "Breadcrumb" : "مسار التنقل"}>
        <Link href={homePath}>{dict.product.breadcrumbsHome}</Link>
        <span>/</span>
        <Link href={productsPath}>{dict.product.breadcrumbsProducts}</Link>
        <span>/</span>
        <span aria-current="page">{product.title}</span>
      </nav>

      <div className="detail-grid">
        <ProductGallery images={images} title={product.title} locale={locale} />

        <div className="detail-copy">
          <span className="kicker">{dict.product.kicker}</span>
          <h1>{product.title}</h1>
          {product.subtitle ? (
            <p className="detail-subtitle">{product.subtitle}</p>
          ) : null}

          <VariantSelector variants={product.variants ?? []} locale={locale} />

          {product.description ? (
            <div className="detail-description">
              <h2>{dict.product.descriptionTitle}</h2>
              <p>{product.description}</p>
            </div>
          ) : null}

          <div className="availability-note">
            <strong>{dict.product.orderNoticeTitle}</strong>
            <p>{dict.product.orderNoticeBody}</p>
          </div>

          <Link className="button button-secondary" href={productsPath}>
            <span>{dict.product.continueShopping}</span>
            <span aria-hidden="true">{arrowNext}</span>
          </Link>
        </div>
      </div>
    </main>
  )
}

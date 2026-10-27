import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { cache } from "react"
import { VariantSelector } from "../../../../components/variant-selector"
import { getDictionary, isLocale, localePath } from "../../../../lib/i18n"
import {
  listStoreProducts,
  productImageUrls,
  productPriceAmount,
  type StoreError,
  type StoreProduct,
} from "../../../../lib/medusa"
import { absoluteUrl, localeAlternates } from "../../../../lib/site"

export const dynamic = "force-dynamic"

type ProductParams = { locale: string; handle: string }

/** Deduped per request so metadata and the page share one Store API call. */
const getProduct = cache(
  async (handle: string): Promise<{ product: StoreProduct | null; error: StoreError }> => {
    const result = await listStoreProducts({ handle, limit: 1 })
    return {
      product: result.products.find((item) => item.handle === handle) ?? null,
      error: result.error,
    }
  }
)

export async function generateMetadata({
  params,
}: {
  params: Promise<ProductParams>
}): Promise<Metadata> {
  const { locale, handle } = await params
  if (!isLocale(locale)) return {}

  const dict = getDictionary(locale)
  const path = `/products/${encodeURIComponent(handle)}`
  const { product } = await getProduct(handle)

  if (!product) {
    return {
      title: dict.product.metaTitleFallback,
      description: dict.product.metaDescriptionFallback,
      alternates: localeAlternates(path, locale),
    }
  }

  const description =
    product.description?.trim().slice(0, 160) ||
    product.subtitle?.trim() ||
    dict.product.metaDescriptionFallback
  const images = productImageUrls(product)

  return {
    title: `${product.title} | ${dict.brand.name}`,
    description,
    alternates: localeAlternates(path, locale),
    openGraph: {
      type: "website",
      title: product.title,
      description,
      url: localePath(locale, path),
      // Only genuine catalog imagery is referenced.
      images: images.length ? [{ url: absoluteUrl(images[0]), alt: product.title }] : undefined,
    },
  }
}

export default async function ProductPage({ params }: { params: Promise<ProductParams> }) {
  const { locale, handle } = await params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)
  const catalog = localePath(locale, "/products")
  const { product, error } = await getProduct(handle)

  if (error) {
    return (
      <main className="shell detail-page" id="main-content">
        <Link href={catalog} className="subtle-link">
          ← {dict.product.backToCatalog}
        </Link>
        <div className="notice" role="status">
          <strong>{dict.catalog.errorTitle}</strong>
          <p>{dict.errors[error]}</p>
        </div>
      </main>
    )
  }

  if (!product) notFound()

  const images = productImageUrls(product)
  const [mainImage, ...extraImages] = images
  const priceAmount = productPriceAmount(product)
  const singleSku =
    (product.variants ?? []).length === 1 ? (product.variants?.[0]?.sku?.trim() ?? "") : ""

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    ...(product.description ? { description: product.description } : {}),
    ...(mainImage ? { image: [absoluteUrl(mainImage)] } : {}),
    ...(singleSku ? { sku: singleSku } : {}),
    // Price is published only when the Store API returned a verified EGP amount.
    ...(priceAmount !== null
      ? {
          offers: {
            "@type": "Offer",
            price: priceAmount.toFixed(2),
            priceCurrency: "EGP",
          },
        }
      : {}),
  }

  return (
    <main className="shell detail-page" id="main-content">
      <nav className="breadcrumbs" aria-label={dict.nav.label}>
        <Link href={localePath(locale, "/")}>{dict.catalog.breadcrumbHome}</Link>
        <span aria-hidden="true">/</span>
        <Link href={catalog}>{dict.catalog.breadcrumb}</Link>
        <span aria-hidden="true">/</span>
        <span>{product.title}</span>
      </nav>
      <div className="detail-grid">
        <div className="detail-gallery" aria-label={dict.product.galleryLabel}>
          {mainImage ? (
            <Image
              src={mainImage}
              alt={product.title}
              width={800}
              height={800}
              unoptimized
              className="detail-main-photo"
              priority
            />
          ) : (
            <div className="detail-no-photo">{dict.product.noImage}</div>
          )}
          {extraImages.length ? (
            <div className="detail-thumbs" aria-hidden="true">
              {extraImages.slice(0, 4).map((url) => (
                <Image
                  key={url}
                  src={url}
                  alt=""
                  width={180}
                  height={180}
                  unoptimized
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="detail-copy">
          <span className="lux-eyebrow">{dict.product.kicker}</span>
          <h1>{product.title}</h1>
          {product.subtitle ? <p className="detail-subtitle">{product.subtitle}</p> : null}
          <VariantSelector variants={product.variants ?? []} locale={locale} />
          {product.description ? (
            <div className="detail-description">
              <h2>{dict.product.descriptionHeading}</h2>
              <p>{product.description}</p>
            </div>
          ) : null}
          <div className="availability-note">
            <strong>{dict.product.orderInfoTitle}</strong>
            <p>{dict.product.orderInfoBody}</p>
            <p>{dict.product.stockNote}</p>
          </div>
          <Link className="button button-secondary" href={catalog}>
            {dict.product.continueShopping} <span aria-hidden="true">←</span>
          </Link>
        </div>
      </div>
      <script
        type="application/ld+json"
        // Only catalog values are serialised, and "<" is escaped.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
    </main>
  )
}

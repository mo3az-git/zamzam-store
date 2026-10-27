import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { cache } from "react"
import { VariantSelector } from "../../../../components/variant-selector"
import { AddToCartPreview } from "../../../../components/add-to-cart-preview"
import { ProductGallery } from "../../../../components/product-gallery"
import { getDictionary, isLocale, localePath, type Locale } from "../../../../lib/i18n"
import {
  buildProductStructuredData,
  listStoreProducts,
  productImageUrls,
  type StoreError,
  type StoreProduct,
} from "../../../../lib/medusa"
import { absoluteUrl, localeAlternates, siteUrl } from "../../../../lib/site"

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
          <span aria-hidden="true">{locale === "en" ? "←" : "→"}</span> {dict.product.backToCatalog}
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

  // DEF-06: Never expose an unsupported Offer while customer purchasing is disabled.
  const structuredData = buildProductStructuredData(product, {
    siteUrl: siteUrl().toString(),
    isPurchasingEnabled: false,
  })

  return (
    <main className="shell detail-page" id="main-content">
      <nav className="breadcrumbs" aria-label={dict.catalog.breadcrumbLabel}>
        <Link href={localePath(locale, "/")}>{dict.catalog.breadcrumbHome}</Link>
        <span aria-hidden="true">/</span>
        <Link href={catalog}>{dict.catalog.breadcrumb}</Link>
        <span aria-hidden="true">/</span>
        <span>{product.title}</span>
      </nav>
      <div className="detail-grid">
        <ProductGallery
          images={images}
          title={product.title}
          galleryLabel={dict.product.galleryLabel}
          imagePosition={dict.product.imagePosition}
          noImageText={dict.product.noImage}
        />
        <div className="detail-copy">
          <span className="lux-eyebrow">{dict.product.kicker}</span>
          <h1>{product.title}</h1>
          {product.subtitle ? <p className="detail-subtitle">{product.subtitle}</p> : null}
          <Suspense fallback={<div className="detail-variant-picker" />}>
            <VariantSelector variants={product.variants ?? []} locale={locale} />
          </Suspense>
          <Suspense fallback={null}>
            <AddToCartPreview
              variantId={product.variants?.[0]?.id ?? ""}
              variantIds={product.variants?.map((variant) => variant.id) ?? []}
              locale={locale as Locale}
              bffEnabled={process.env.ZAMZAM_CART_BFF_ENABLED === "true"}
            />
          </Suspense>
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
            {dict.product.continueShopping} <span aria-hidden="true">{locale === "en" ? "→" : "←"}</span>
          </Link>
        </div>
      </div>
      <script
        type="application/ld+json"
        // Only genuine catalog values are serialised, and "<" is escaped.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
    </main>
  )
}

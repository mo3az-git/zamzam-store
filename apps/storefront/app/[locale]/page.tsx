import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ProductCard } from "../../components/product-card"
import { formatNumber, getDictionary, isLocale, localePath } from "../../lib/i18n"
import { displayPrice, listStoreCategories, listStoreProducts } from "../../lib/medusa"

export const dynamic = "force-dynamic"

/**
 * Arabic Luxury — an editorial storefront with real Medusa products and
 * collections. Any imagery, category or monetary value shown here originates
 * from the Store API; the typographic artwork is explicitly a brand
 * composition, not packaging.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)
  const catalog = localePath(locale, "/products")

  const [result, categoryResult] = await Promise.all([
    listStoreProducts({ limit: 4 }),
    listStoreCategories({ limit: 24 }),
  ])

  const heroProduct = result.products.find((product) => Boolean(product.thumbnail))
  const collections = categoryResult.categories
    .filter((category) => !category.parent_category_id)
    .slice(0, 4)
  const categoryTones = ["lux-category-dates", "lux-category-water"]

  return (
    <main id="main-content">
      <section className="lux-hero" aria-labelledby="lux-hero-title">
        <div className="lux-hero-edge" aria-hidden="true">
          THE EDITION · 01
        </div>
        <div className="shell lux-hero-grid">
          <div className="lux-hero-copy">
            <div className="lux-overline">
              <span className="lux-rule" aria-hidden="true" />
              <span>{dict.home.overline}</span>
              <span className="lux-overline-en" dir="ltr">
                {dict.home.overlineEn}
              </span>
            </div>

            <h1 id="lux-hero-title">
              {dict.home.titleLead}
              <br />
              <span>{dict.home.titleAccent}</span>
            </h1>

            <p className="lux-intro">{dict.home.intro}</p>

            <div className="lux-hero-actions">
              <Link className="lux-button lux-button-dark" href={catalog}>
                {dict.home.primaryCta}
                <span aria-hidden="true">↖</span>
              </Link>
              <a className="lux-text-link" href="#lux-collections">
                {dict.home.secondaryCta}
                <span aria-hidden="true">↓</span>
              </a>
            </div>

            <div className="lux-signature">
              <span className="lux-signature-mark" aria-hidden="true">
                ز
              </span>
              <span>
                {dict.home.signature.split("\n").map((line, index) => (
                  <span key={line}>
                    {index > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </span>
              <span className="lux-signature-line" aria-hidden="true" />
            </div>
          </div>

          <div className="lux-hero-stage">
            <div className="lux-stage-borders" aria-hidden="true" />
            {heroProduct?.thumbnail ? (
              <Link
                href={`${catalog}/${encodeURIComponent(heroProduct.handle)}`}
                className="lux-stage-photo"
                aria-label={`${dict.home.captionLabel}: ${heroProduct.title}`}
              >
                <Image
                  src={heroProduct.thumbnail}
                  alt={heroProduct.title}
                  width={740}
                  height={900}
                  priority
                  unoptimized
                />
                <span className="lux-photo-caption">
                  <span>
                    <small>{dict.home.captionLabel}</small>
                    <strong>{heroProduct.title}</strong>
                    <em>{displayPrice(heroProduct, locale) ?? dict.product.priceUnavailable}</em>
                  </span>
                  <span className="lux-photo-arrow" aria-hidden="true">
                    ↗
                  </span>
                </span>
              </Link>
            ) : (
              <div className="lux-stage-typography" role="img" aria-label={dict.home.artLabel}>
                <div className="lux-stage-inner-stroke" aria-hidden="true" />
                <span className="lux-stage-no" aria-hidden="true">
                  01 — ZAMZAM STORE
                </span>
                <div className="lux-stage-monogram" aria-hidden="true">
                  ز
                </div>
                <div className="lux-stage-logo" aria-hidden="true">
                  زمزم
                </div>
                <div className="lux-stage-note" aria-hidden="true">
                  {dict.brand.sub}
                </div>
                <div className="lux-stage-seal" aria-hidden="true">
                  <span>ز</span>
                  <small>STUDIO</small>
                </div>
                <span className="lux-stage-bottom" aria-hidden="true">
                  DESIGNED FOR THE DETAILS
                </span>
              </div>
            )}
            <div className="lux-side-caption" aria-hidden="true">
              EXPERIENCE · ARABIC FIRST
            </div>
            <span className="lux-hero-index" aria-hidden="true">
              {formatNumber(1, locale)} / {formatNumber(3, locale)}
            </span>
          </div>
        </div>
        <div className="shell lux-hero-foot">
          <span>{dict.home.footStart}</span>
          <span className="lux-foot-deco" aria-hidden="true">
            ✧
          </span>
          <span>{dict.home.footEnd}</span>
        </div>
      </section>

      <section className="lux-qualities" aria-label={dict.home.qualities.join(" · ")}>
        <div className="shell lux-qualities-grid">
          {dict.home.qualities.map((quality, index) => (
            <div key={quality}>
              <span className="lux-quality-symbol" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{quality}</span>
            </div>
          ))}
        </div>
      </section>

      <section
        className="shell lux-collections"
        id="lux-collections"
        aria-labelledby="lux-collections-title"
      >
        <div className="lux-section-heading">
          <div>
            <span className="lux-eyebrow">{dict.home.collectionsEyebrow}</span>
            <h2 id="lux-collections-title">
              {dict.home.collectionsTitle} <span>{dict.home.collectionsAccent}</span>
            </h2>
          </div>
          <p>{dict.home.collectionsIntro}</p>
        </div>

        {collections.length ? (
          <div className="lux-category-grid">
            {collections.map((category, index) => (
              <Link
                key={category.id}
                className={`lux-category ${categoryTones[index % categoryTones.length]}`}
                href={`${catalog}?category=${encodeURIComponent(category.handle)}`}
              >
                <div className="lux-category-top">
                  <span>
                    {dict.home.collectionOrdinals[index] ?? dict.home.collectionOrdinals[3]}
                  </span>
                  <span className="lux-category-arrow" aria-hidden="true">
                    ↗
                  </span>
                </div>
                <div className="lux-category-center" aria-hidden="true">
                  <span className="lux-decor-word">{category.name}</span>
                  <span className="lux-decor-accent" />
                </div>
                <div className="lux-category-bottom">
                  <span className="lux-category-number" dir="ltr">
                    {String(index + 1).padStart(2, "0")} / {dict.home.collectionWord}
                  </span>
                  <div>
                    <h3>{category.name}</h3>
                    <span>
                      {dict.home.collectionCta} <span aria-hidden="true">↗</span>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="lux-category-empty" role="status">
            <span className="lux-eyebrow">{dict.home.collectionsEyebrow}</span>
            <h3>{dict.home.collectionsEmptyTitle}</h3>
            <p>{dict.home.collectionsEmptyBody}</p>
            <Link href={catalog} className="lux-list-link">
              {dict.home.stateOpenCatalog} <span aria-hidden="true">↖</span>
            </Link>
          </div>
        )}
      </section>

      <section className="lux-featured" aria-labelledby="lux-featured-title">
        <div className="shell">
          <div className="lux-section-heading lux-featured-heading">
            <div>
              <span className="lux-eyebrow">{dict.home.featuredEyebrow}</span>
              <h2 id="lux-featured-title">
                {dict.home.featuredTitle} <span>{dict.home.featuredAccent}</span>
              </h2>
            </div>
            <Link className="lux-list-link" href={catalog}>
              {dict.home.viewAll} <span aria-hidden="true">↖</span>
            </Link>
          </div>

          {result.error ? (
            <div className="lux-catalog-state" role="status">
              <div className="lux-state-emblem" aria-hidden="true">
                ز
              </div>
              <div>
                <span className="lux-eyebrow">{dict.home.stateErrorEyebrow}</span>
                <h3>{dict.home.stateErrorTitle}</h3>
                <p>{dict.errors[result.error]}</p>
                <Link href={catalog} className="lux-list-link">
                  {dict.home.stateOpenCatalog} <span aria-hidden="true">↖</span>
                </Link>
              </div>
            </div>
          ) : result.products.length ? (
            <div className="products-grid lux-product-grid">
              {result.products.map((product) => (
                <ProductCard key={product.id} product={product} locale={locale} />
              ))}
            </div>
          ) : (
            <div className="lux-catalog-state" role="status">
              <div className="lux-state-emblem" aria-hidden="true">
                ز
              </div>
              <div>
                <span className="lux-eyebrow">{dict.home.stateEmptyEyebrow}</span>
                <h3>{dict.home.stateEmptyTitle}</h3>
                <p>{dict.home.stateEmptyBody}</p>
                <Link href={catalog} className="lux-list-link">
                  {dict.home.stateOpenCatalog} <span aria-hidden="true">↖</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="lux-finale" aria-labelledby="lux-finale-title">
        <div className="shell lux-finale-content">
          <div className="lux-finale-decoration" aria-hidden="true">
            ز
          </div>
          <div>
            <span className="lux-eyebrow">{dict.home.finaleEyebrow}</span>
            <h2 id="lux-finale-title">
              {dict.home.finaleTitle} <span>{dict.home.finaleAccent}</span>
            </h2>
            <p>{dict.home.finaleBody}</p>
            <Link className="lux-button lux-button-cream" href={catalog}>
              {dict.home.finaleCta}
              <span aria-hidden="true">↖</span>
            </Link>
          </div>
          <span className="lux-finale-side" aria-hidden="true">
            CURATED WITH PURPOSE
          </span>
        </div>
      </section>
    </main>
  )
}

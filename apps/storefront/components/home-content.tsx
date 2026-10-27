import Image from "next/image"
import Link from "next/link"
import { ProductCard } from "./product-card"
import { displayPrice, listStoreProducts, storeErrorMessage } from "../lib/medusa"
import { getDictionary, type Locale } from "../lib/i18n"

export async function HomeContent({ locale = "ar" }: { locale?: Locale }) {
  const dict = getDictionary(locale)
  const isEn = locale === "en"
  const productsPath = isEn ? "/en/products" : "/products"
  const datesHref = isEn ? "/en/products?q=date" : "/products?q=تمر"
  const waterHref = isEn ? "/en/products?q=zamzam" : "/products?q=زمزم"

  const result = await listStoreProducts({ limit: 4 })
  const heroProduct = result.products.find((product) => Boolean(product.thumbnail))
  const arrowDiagonal = isEn ? "↗" : "↖"
  const arrowBack = isEn ? "←" : "→"

  return (
    <main id="main-content">
      <section className="lux-hero" aria-labelledby="lux-hero-title">
        <div className="lux-hero-edge" aria-hidden="true">{dict.brand.edition}</div>
        <div className="shell lux-hero-grid">
          <div className="lux-hero-copy">
            <div className="lux-overline">
              <span className="lux-rule" aria-hidden="true" />
              <span>{dict.hero.overline}</span>
            </div>

            <h1 id="lux-hero-title">
              {dict.hero.headlineLine1}<br />
              <span>{dict.hero.headlineSpan}</span>
            </h1>

            <p className="lux-intro">{dict.hero.intro}</p>

            <div className="lux-hero-actions">
              <Link className="lux-button lux-button-dark" href={productsPath}>
                <span>{dict.hero.exploreButton}</span>
                <span className="lux-arrow-icon" aria-hidden="true">{arrowDiagonal}</span>
              </Link>
              <a className="lux-text-link" href="#lux-collections">
                <span>{dict.hero.collectionsLink}</span>
                <span aria-hidden="true">↓</span>
              </a>
            </div>

            <div className="lux-signature">
              <span className="lux-signature-mark" aria-hidden="true">ز</span>
              <span>
                {dict.hero.signature1}<br />
                {dict.hero.signature2}
              </span>
              <span className="lux-signature-line" aria-hidden="true" />
            </div>
          </div>

          <div className="lux-hero-stage">
            <div className="lux-stage-borders" aria-hidden="true" />
            {heroProduct?.thumbnail ? (
              <Link
                href={isEn ? `/en/products/${encodeURIComponent(heroProduct.handle)}` : `/products/${encodeURIComponent(heroProduct.handle)}`}
                className="lux-stage-photo"
                aria-label={`${heroProduct.title}`}
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
                    <small>{dict.hero.artCaption}</small>
                    <strong>{heroProduct.title}</strong>
                    <em>{displayPrice(heroProduct, locale) ?? dict.product.priceUnavailable}</em>
                  </span>
                  <span className="lux-photo-arrow" aria-hidden="true">↗</span>
                </span>
              </Link>
            ) : (
              <div
                className="lux-stage-typography"
                role="img"
                aria-label={dict.hero.artworkLabel}
              >
                <div className="lux-stage-inner-stroke" aria-hidden="true" />
                <span className="lux-stage-no" aria-hidden="true">01 — ZAMZAM STORE</span>
                <div className="lux-stage-monogram" aria-hidden="true">ز</div>
                <div className="lux-stage-logo" aria-hidden="true">{dict.brand.name}</div>
                <div className="lux-stage-note" aria-hidden="true">{dict.brand.tagline}</div>
                <div className="lux-stage-seal" aria-hidden="true">
                  <span>ز</span>
                  <small>STUDIO</small>
                </div>
                <span className="lux-stage-bottom" aria-hidden="true">DESIGNED FOR THE DETAILS</span>
              </div>
            )}
            <div className="lux-side-caption" aria-hidden="true">
              {isEn ? "EXPERIENCE · HERITAGE FIRST" : "EXPERIENCE · ARABIC FIRST"}
            </div>
            <span className="lux-hero-index" aria-hidden="true">٠١ / ٠٣</span>
          </div>
        </div>
        <div className="shell lux-hero-foot">
          <span>{isEn ? "Authentic data directly from store catalog" : "تصفّح بثقة في مصدر البيانات"}</span>
          <span className="lux-foot-deco" aria-hidden="true">✧</span>
          <span>{dict.hero.tagline}</span>
        </div>
      </section>

      <section className="lux-qualities" aria-label={isEn ? "Store experience qualities" : "مميزات تجربة التصفح"}>
        <div className="shell lux-qualities-grid">
          <div>
            <span className="lux-quality-symbol" aria-hidden="true">{dict.qualities.q1Symbol}</span>
            <span>{dict.qualities.q1Text}</span>
          </div>
          <div>
            <span className="lux-quality-symbol" aria-hidden="true">{dict.qualities.q2Symbol}</span>
            <span>{dict.qualities.q2Text}</span>
          </div>
          <div>
            <span className="lux-quality-symbol" aria-hidden="true">{dict.qualities.q3Symbol}</span>
            <span>{dict.qualities.q3Text}</span>
          </div>
        </div>
      </section>

      <section className="shell lux-collections" id="lux-collections" aria-labelledby="lux-collections-title">
        <div className="lux-section-heading">
          <div>
            <span className="lux-eyebrow">{dict.collections.eyebrow}</span>
            <h2 id="lux-collections-title">
              {dict.collections.title}<span>{dict.collections.titleSpan}</span>
            </h2>
          </div>
          <p>{dict.collections.intro}</p>
        </div>

        <div className="lux-category-grid">
          <Link className="lux-category lux-category-dates" href={datesHref}>
            <div className="lux-category-top">
              <span>{dict.collections.datesTitle}</span>
              <span className="lux-category-arrow" aria-hidden="true">↗</span>
            </div>
            <div className="lux-category-center" aria-hidden="true">
              <span className="lux-decor-word">{isEn ? "DATES" : "تمر"}</span>
              <span className="lux-decor-accent" />
            </div>
            <div className="lux-category-bottom">
              <span className="lux-category-number">{dict.collections.datesBadge}</span>
              <div>
                <h3>{dict.collections.datesTitle}</h3>
                <span>{dict.collections.discoverCategory} <span aria-hidden="true">↗</span></span>
              </div>
            </div>
          </Link>

          <Link className="lux-category lux-category-water" href={waterHref}>
            <div className="lux-category-top">
              <span>{dict.collections.waterTitle}</span>
              <span className="lux-category-arrow" aria-hidden="true">↗</span>
            </div>
            <div className="lux-category-center" aria-hidden="true">
              <span className="lux-decor-word">{isEn ? "ZAMZAM" : "زمزم"}</span>
              <span className="lux-decor-accent" />
            </div>
            <div className="lux-category-bottom">
              <span className="lux-category-number">{dict.collections.waterBadge}</span>
              <div>
                <h3>{dict.collections.waterTitle}</h3>
                <span>{dict.collections.discoverCategory} <span aria-hidden="true">↗</span></span>
              </div>
            </div>
          </Link>
        </div>
      </section>

      <section className="lux-featured" aria-labelledby="lux-featured-title">
        <div className="shell">
          <div className="lux-section-heading lux-featured-heading">
            <div>
              <span className="lux-eyebrow">{dict.catalog.kicker} / 02</span>
              <h2 id="lux-featured-title">
                {dict.catalog.featuredTitle}<span>{dict.catalog.featuredTitleSpan}</span>
              </h2>
            </div>
            <Link className="lux-list-link" href={productsPath}>
              <span>{dict.catalog.allProductsLink}</span>
              <span className="lux-arrow-icon" aria-hidden="true">{arrowDiagonal}</span>
            </Link>
          </div>

          {result.error ? (
            <div className="lux-catalog-state" role="status">
              <div className="lux-state-emblem" aria-hidden="true">ز</div>
              <div>
                <span className="lux-eyebrow">{isEn ? "CATALOG STATUS" : "إعداد الكتالوج"}</span>
                <h3>{isEn ? "Products currently unavailable." : "المنتجات غير متاحة للعرض الآن."}</h3>
                <p>{storeErrorMessage(result.error, locale)}</p>
                <Link href={productsPath} className="lux-list-link">
                  <span>{dict.catalog.allProductsLink}</span>
                  <span className="lux-arrow-icon" aria-hidden="true">{arrowDiagonal}</span>
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
              <div className="lux-state-emblem" aria-hidden="true">ز</div>
              <div>
                <span className="lux-eyebrow">{dict.catalog.kicker}</span>
                <h3>{dict.catalog.noProductsTitle}</h3>
                <p>{dict.catalog.noProductsEmpty}</p>
                <Link href={productsPath} className="lux-list-link">
                  <span>{dict.catalog.allProductsLink}</span>
                  <span className="lux-arrow-icon" aria-hidden="true">{arrowDiagonal}</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="lux-finale" aria-labelledby="lux-finale-title">
        <div className="shell lux-finale-content">
          <div className="lux-finale-decoration" aria-hidden="true">ز</div>
          <div>
            <span className="lux-eyebrow">{dict.brand.nameTranslit}</span>
            <h2 id="lux-finale-title">
              {isEn ? "Your journey begins " : "اختيارك يبدأ "}
              <span>{isEn ? "here." : "من هنا."}</span>
            </h2>
            <p>
              {isEn
                ? "Transparent product details, authentic Arabic craft, showcasing genuine store inventory without unverified claims."
                : "صفحات منتجات واضحة، وتجربة عربية تُظهر ما يقدّمه الكتالوج بالفعل دون وعود غير مؤكدة."}
            </p>
            <Link className="lux-button lux-button-cream" href={productsPath}>
              <span>{isEn ? "Explore Catalog" : "ابدأ التصفح"}</span>
              <span className="lux-arrow-icon" aria-hidden="true">{arrowDiagonal}</span>
            </Link>
          </div>
          <span className="lux-finale-side" aria-hidden="true">{dict.hero.curatedPurpose}</span>
        </div>
      </section>
    </main>
  )
}

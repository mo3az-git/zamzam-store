import Image from "next/image"
import Link from "next/link"
import { ProductCard } from "../components/product-card"
import { displayPrice, listStoreProducts, storeErrorMessage } from "../lib/medusa"

export const dynamic = "force-dynamic"

/**
 * Arabic Luxury — an editorial storefront with real Medusa products.
 * Any imagery or monetary value shown here originates from the Store API;
 * the typographic artwork is explicitly a brand composition, not packaging.
 */
export default async function Home() {
  const result = await listStoreProducts({ limit: 4 })
  const heroProduct = result.products.find((product) => Boolean(product.thumbnail))

  return (
    <main id="main-content">
      <section className="lux-hero" aria-labelledby="lux-hero-title">
        <div className="lux-hero-edge" aria-hidden="true">THE EDITION · 01</div>
        <div className="shell lux-hero-grid">
          <div className="lux-hero-copy">
            <div className="lux-overline">
              <span className="lux-rule" aria-hidden="true" />
              <span>زمزم ستور</span>
              <span className="lux-overline-en">ZAMZAM / COLLECTIONS</span>
            </div>

            <h1 id="lux-hero-title">في كل تفصيلة،<br />
              <span>حكاية ذوق.</span>
            </h1>

            <p className="lux-intro">مساحة عربية مختارة لتصفّح مياه زمزم المعبأة والتمور؛ تفاصيل واضحة، وهوية هادئة، ومنتجات تُعرض مباشرة من كتالوج المتجر.</p>

            <div className="lux-hero-actions">
              <Link className="lux-button lux-button-dark" href="/products">
                اكتشف المجموعة
                <span aria-hidden="true">↖</span>
              </Link>
              <a className="lux-text-link" href="#lux-collections">
                تعرّف على الأقسام
                <span aria-hidden="true">↓</span>
              </a>
            </div>

            <div className="lux-signature">
              <span className="lux-signature-mark" aria-hidden="true">ز</span>
              <span>ذوق عربي،<br />بتفاصيل معاصرة.</span>
              <span className="lux-signature-line" aria-hidden="true" />
            </div>
          </div>

          <div className="lux-hero-stage">
            <div className="lux-stage-borders" aria-hidden="true" />
            {heroProduct?.thumbnail ? (
              <Link
                href={"/products/" + encodeURIComponent(heroProduct.handle)}
                className="lux-stage-photo"
                aria-label={"اكتشف " + heroProduct.title}
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
                    <small>من الكتالوج</small>
                    <strong>{heroProduct.title}</strong>
                    <em>{displayPrice(heroProduct) ?? "السعر حسب المنطقة"}</em>
                  </span>
                  <span className="lux-photo-arrow" aria-hidden="true">↗</span>
                </span>
              </Link>
            ) : (
              <div className="lux-stage-typography" role="img" aria-label="لوحة طباعية زخرفية تحمل اسم زمزم ستور؛ ليست صورة منتج">
                <div className="lux-stage-inner-stroke" aria-hidden="true" />
                <span className="lux-stage-no" aria-hidden="true">01 — ZAMZAM STORE</span>
                <div className="lux-stage-monogram" aria-hidden="true">ز</div>
                <div className="lux-stage-logo" aria-hidden="true">زمزم</div>
                <div className="lux-stage-note" aria-hidden="true">ذوق يليق بالتفاصيل</div>
                <div className="lux-stage-seal" aria-hidden="true"><span>ز</span><small>STUDIO</small></div>
                <span className="lux-stage-bottom" aria-hidden="true">DESIGNED FOR THE DETAILS</span>
              </div>
            )}
            <div className="lux-side-caption" aria-hidden="true">EXPERIENCE · ARABIC FIRST</div>
            <span className="lux-hero-index" aria-hidden="true">٠١ / ٠٣</span>
          </div>
        </div>
        <div className="shell lux-hero-foot">
          <span>تصفّح بثقة في مصدر البيانات</span>
          <span className="lux-foot-deco" aria-hidden="true">✧</span>
          <span>تصميم للتفاصيل · صنع بالعربية</span>
        </div>
      </section>

      <section className="lux-qualities" aria-label="مميزات تجربة التصفح">
        <div className="shell lux-qualities-grid">
          <div><span className="lux-quality-symbol" aria-hidden="true">01</span><span>تجربة عربية من البداية</span></div>
          <div><span className="lux-quality-symbol" aria-hidden="true">02</span><span>الأسعار من نظام المتجر</span></div>
          <div><span className="lux-quality-symbol" aria-hidden="true">03</span><span>تفاصيل المنتجات كما هي مسجلة</span></div>
        </div>
      </section>

      <section className="shell lux-collections" id="lux-collections" aria-labelledby="lux-collections-title">
        <div className="lux-section-heading">
          <div>
            <span className="lux-eyebrow">الأقسام / ٠١</span>
            <h2 id="lux-collections-title">اختيارات، <span>لها طابعها.</span></h2>
          </div>
          <p>ابدأ من المجموعة التي تبحث عنها. تظهر المنتجات عند إضافتها ونشرها في الكتالوج.</p>
        </div>

        <div className="lux-category-grid">
          <Link className="lux-category lux-category-dates" href="/products?q=تمر">
            <div className="lux-category-top">
              <span>المجموعة الأولى</span>
              <span className="lux-category-arrow" aria-hidden="true">↗</span>
            </div>
            <div className="lux-category-center" aria-hidden="true">
              <span className="lux-decor-word">تمر</span>
              <span className="lux-decor-accent" />
            </div>
            <div className="lux-category-bottom">
              <span className="lux-category-number">01 / COLLECTION</span>
              <div>
                <h3>التمور</h3>
                <span>اكتشف ما هو مدرج في الكتالوج <span aria-hidden="true">↗</span></span>
              </div>
            </div>
          </Link>

          <Link className="lux-category lux-category-water" href="/products?q=زمزم">
            <div className="lux-category-top">
              <span>المجموعة الثانية</span>
              <span className="lux-category-arrow" aria-hidden="true">↗</span>
            </div>
            <div className="lux-category-center" aria-hidden="true">
              <span className="lux-decor-word">زمزم</span>
              <span className="lux-decor-accent" />
            </div>
            <div className="lux-category-bottom">
              <span className="lux-category-number">02 / COLLECTION</span>
              <div>
                <h3>مياه زمزم</h3>
                <span>اكتشف ما هو مدرج في الكتالوج <span aria-hidden="true">↗</span></span>
              </div>
            </div>
          </Link>
        </div>
      </section>

      <section className="lux-featured" aria-labelledby="lux-featured-title">
        <div className="shell">
          <div className="lux-section-heading lux-featured-heading">
            <div>
              <span className="lux-eyebrow">من الكتالوج / ٠٢</span>
              <h2 id="lux-featured-title">لأن التفاصيل <span>تصنع الفارق.</span></h2>
            </div>
            <Link className="lux-list-link" href="/products">عرض جميع المنتجات <span aria-hidden="true">↖</span></Link>
          </div>

          {result.error ? (
            <div className="lux-catalog-state" role="status">
              <div className="lux-state-emblem" aria-hidden="true">ز</div>
              <div>
                <span className="lux-eyebrow">إعداد الكتالوج</span>
                <h3>المنتجات غير متاحة للعرض الآن.</h3>
                <p>{storeErrorMessage(result.error)}</p>
                <Link href="/products" className="lux-list-link">افتح صفحة الكتالوج <span aria-hidden="true">↖</span></Link>
              </div>
            </div>
          ) : result.products.length ? (
            <div className="products-grid lux-product-grid">
              {result.products.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          ) : (
            <div className="lux-catalog-state" role="status">
              <div className="lux-state-emblem" aria-hidden="true">ز</div>
              <div>
                <span className="lux-eyebrow">المنتجات</span>
                <h3>أول مجموعة لم تُنشر بعد.</h3>
                <p>تظهر المنتجات الحقيقية هنا تلقائيًا بمجرد نشرها في Medusa. لا نعرض صورًا أو أسعارًا افتراضية.</p>
                <Link href="/products" className="lux-list-link">تصفّح الكتالوج <span aria-hidden="true">↖</span></Link>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="lux-finale" aria-labelledby="lux-finale-title">
        <div className="shell lux-finale-content">
          <div className="lux-finale-decoration" aria-hidden="true">ز</div>
          <div>
            <span className="lux-eyebrow">زمزم ستور / التفاصيل أولًا</span>
            <h2 id="lux-finale-title">اختيارك يبدأ <span>من هنا.</span></h2>
            <p>صفحات منتجات واضحة، وتجربة عربية تُظهر ما يقدّمه الكتالوج بالفعل دون وعود غير مؤكدة.</p>
            <Link className="lux-button lux-button-cream" href="/products">
              ابدأ التصفح
              <span aria-hidden="true">↖</span>
            </Link>
          </div>
          <span className="lux-finale-side" aria-hidden="true">CURATED WITH PURPOSE</span>
        </div>
      </section>
    </main>
  )
}

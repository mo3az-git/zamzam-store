import Link from "next/link"
import { OasisIllustration } from "../components/oasis-illustration"
import { ProductCard } from "../components/product-card"
import { listStoreProducts, storeErrorMessage } from "../lib/medusa"

export const dynamic = "force-dynamic"

function ArrowIcon({ diagonal = false }: { diagonal?: boolean }) {
  return <span className="arrow-glyph" aria-hidden="true">{diagonal ? "↗" : "↙"}</span>
}

export default async function Home() {
  const result = await listStoreProducts({ limit: 4 })

  return (
    <main id="main-content">
      <section className="editorial-hero" aria-labelledby="hero-heading">
        <div className="shell editorial-hero-grid">
          <div className="editorial-content">
            <div className="edition-kicker"><span className="edition-kicker-line" /> <span>مساحة للاختيار على مهل</span><span className="edition-number">01 / ZAMZAM</span></div>
            <h1 id="hero-heading">من الواحة،<br /><span>إلى تفاصيل</span><br /><span className="hero-last-line">يومك<span className="hero-fullstop">.</span></span></h1>
            <p className="editorial-lede">مياه زمزم المعبأة والتمور في مساحة واحدة؛ تصميم عربي هادئ، وتفاصيل وأسعار تُعرض مباشرةً من كتالوج المتجر عند توفرها.</p>
            <div className="editorial-actions">
              <Link href="/products" className="atelier-button atelier-button-primary">تصفح الكتالوج <ArrowIcon /></Link>
              <a href="#collections" className="atelier-button atelier-button-quiet">اكتشف المجموعات <span aria-hidden="true">↓</span></a>
            </div>
            <div className="hero-bottom-note">
              <span className="hero-bottom-rule" />
              <span>رحلة تصفّح تبدأ من التفاصيل.</span>
              <span className="hero-note-star" aria-hidden="true">✳</span>
            </div>
          </div>

          <div className="editorial-artframe">
            <div className="artframe-backdrop" aria-hidden="true" />
            <OasisIllustration />
            <div className="artframe-seal"><span>ز</span><small>زمزم ستور</small></div>
            <div className="artframe-side-note">A STUDY IN WATER & EARTH</div>
            <div className="artframe-legend"><span className="legend-dot" /> فن مستوحى من الواحة</div>
          </div>
        </div>
        <div className="hero-folio shell" aria-hidden="true"><span>مجموعة زمزم ستور</span><span>EST. ONLINE · EGYPT</span><span>✦</span></div>
      </section>

      <div className="collection-ribbon" aria-label="أقسام المتجر">
        <div className="shell ribbon-inner"><span>مياه زمزم</span><span className="ribbon-ornament" aria-hidden="true">✳</span><span>التمور</span><span className="ribbon-ornament" aria-hidden="true">✳</span><span>تفاصيل تُروى بالعربية</span><span className="ribbon-ornament" aria-hidden="true">✳</span><span>اختيارات من الكتالوج</span></div>
      </div>

      <section id="collections" className="shell collections-section" aria-labelledby="collections-heading">
        <div className="atelier-section-heading">
          <div>
            <span className="overline"><span className="overline-index">02</span> المجموعات</span>
            <h2 id="collections-heading">كل مجموعة،<br /><em>لها حكايتها.</em></h2>
          </div>
          <p>تصفّح ما هو مدرج في كتالوج المتجر. الفئات هنا مدخل للاكتشاف، وليست إشارة إلى توافر مخزون محدد.</p>
        </div>
        <div className="editorial-collections">
          <Link className="collection-panel collection-panel-water" href="/products?q=زمزم">
            <div className="collection-panel-top"><span>01 / COLLECTION</span><span className="collection-panel-round" aria-hidden="true">↗</span></div>
            <div className="collection-water-ornament" aria-hidden="true">
              <span className="water-orb water-orb-one" /><span className="water-orb water-orb-two" />
              <svg viewBox="0 0 500 230" preserveAspectRatio="none"><path d="M-20 120C85 20 152 208 255 120C352 37 409 176 520 90" /><path d="M-20 157C94 66 160 239 263 155C373 66 429 199 520 125" /></svg>
            </div>
            <div className="collection-panel-bottom"><span className="collection-panel-symbol">م</span><div><span className="collection-descriptor">المجموعة الأولى</span><h3>مياه زمزم</h3><span className="collection-open">استكشف المجموعة <ArrowIcon /></span></div></div>
          </Link>
          <Link className="collection-panel collection-panel-dates" href="/products?q=تمر">
            <div className="collection-panel-top"><span>02 / COLLECTION</span><span className="collection-panel-round" aria-hidden="true">↗</span></div>
            <div className="collection-dates-ornament" aria-hidden="true">
              <span className="date-leaf leaf-a" /><span className="date-leaf leaf-b" /><span className="date-leaf leaf-c" />
              <span className="date-fruit fruit-a" /><span className="date-fruit fruit-b" /><span className="date-fruit fruit-c" /><span className="date-fruit fruit-d" />
            </div>
            <div className="collection-panel-bottom"><span className="collection-panel-symbol">ت</span><div><span className="collection-descriptor">المجموعة الثانية</span><h3>التمور</h3><span className="collection-open">استكشف المجموعة <ArrowIcon /></span></div></div>
          </Link>
        </div>
      </section>

      <section className="products-showcase" aria-labelledby="products-heading">
        <div className="shell">
          <div className="atelier-section-heading showcase-heading">
            <div><span className="overline"><span className="overline-index">03</span> من الكتالوج</span><h2 id="products-heading">تأمّل التفاصيل.<br /><em>واختر ما يناسبك.</em></h2></div>
            <Link className="atelier-inline-link" href="/products">كل المنتجات <ArrowIcon diagonal /></Link>
          </div>
          {result.error ? (
            <div className="atelier-empty" role="status">
              <div className="empty-illustration" aria-hidden="true">✳</div>
              <div><span className="overline">معلومة من المتجر</span><h3>الكتالوج غير متصل الآن.</h3><p>{storeErrorMessage(result.error)}</p><Link href="/products" className="atelier-inline-link">الذهاب إلى صفحة المنتجات <ArrowIcon /></Link></div>
            </div>
          ) : result.products.length ? (
            <div className="products-grid editorial-product-grid">{result.products.map((product, index) => <ProductCard key={product.id} index={index + 1} product={product} />)}</div>
          ) : (
            <div className="atelier-empty" role="status">
              <div className="empty-illustration" aria-hidden="true">✳</div>
              <div><span className="overline">قريبًا في الكتالوج</span><h3>الرفوف تنتظر أول منتجاتها.</h3><p>ستظهر المنتجات المنشورة تلقائيًا عند إضافتها في Medusa وربط قناة البيع بالمتجر.</p><Link href="/products" className="atelier-inline-link">استكشف صفحة المنتجات <ArrowIcon /></Link></div>
            </div>
          )}
        </div>
      </section>

      <section className="manifesto-band" aria-labelledby="manifesto-heading">
        <div className="shell manifesto-layout">
          <div className="manifesto-emblem" aria-hidden="true"><span>ز</span><span className="emblem-star">✳</span></div>
          <div className="manifesto-copy">
            <span className="overline">04 / التجربة</span>
            <h2 id="manifesto-heading">المميز ليس كثرة الكلام،<br /><em>بل وضوح التفاصيل.</em></h2>
            <p>لهذا تُقرأ أسماء المنتجات وأوصافها وأسعارها من كتالوج Medusa، دون اختلاق صور أو بيانات أو ادعاءات عن التوافر.</p>
            <Link href="/products" className="atelier-button atelier-button-ivory">ابدأ التصفح <ArrowIcon /></Link>
          </div>
          <span className="manifesto-vertical" aria-hidden="true">ZAMZAM STORE · EDITION 01</span>
        </div>
      </section>
    </main>
  )
}

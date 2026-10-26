import Link from "next/link"
import { ProductCard } from "../components/product-card"
import { listStoreProducts, storeErrorMessage } from "../lib/medusa"

export const dynamic = "force-dynamic"

export default async function Home() {
  const result = await listStoreProducts({ limit: 4 })
  return (
    <main>
      <section className="hero">
        <div className="shell hero-layout">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-dot" /> متجر إلكتروني بتجربة عربية</span>
            <h1>اختيارات بسيطة، <span>وتسوّق أوضح.</span></h1>
            <p>تعرّف على مجموعة المتجر من مياه زمزم المعبأة والتمور. تفاصيل المنتجات وأسعارها تُعرض مباشرةً من نظام المتجر عند إتاحتها.</p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/products">استكشف المنتجات <span aria-hidden="true">←</span></Link>
              <a className="button button-secondary" href="#categories">تصفح الأقسام</a>
            </div>
            <p className="hero-small">المنتجات تخضع للتحقق من بياناتها وتوافرها قبل إتاحتها للشراء.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-ring ring-one" />
            <div className="hero-ring ring-two" />
            <div className="hero-center"><div className="hero-mark">ز</div><span>زمزم ستور</span></div>
            <span className="hero-art-caption">ZAMZAM · STORE</span>
          </div>
        </div>
      </section>

      <section className="shell section" id="categories" aria-labelledby="categories-heading">
        <div className="section-heading">
          <div><span className="kicker">أقسام المتجر</span><h2 id="categories-heading">ابدأ من اللي بتدور عليه</h2></div>
        </div>
        <div className="category-grid">
          <Link href="/products?q=زمزم" className="category-tile category-water">
            <span className="category-number">01 / القسم</span><span className="category-symbol" aria-hidden="true">◌</span>
            <span className="category-copy"><strong>مياه زمزم</strong><span>ابحث في المنتجات <span aria-hidden="true">←</span></span></span>
          </Link>
          <Link href="/products?q=تمر" className="category-tile category-dates">
            <span className="category-number">02 / القسم</span><span className="category-symbol" aria-hidden="true">✳</span>
            <span className="category-copy"><strong>التمور</strong><span>ابحث في المنتجات <span aria-hidden="true">←</span></span></span>
          </Link>
        </div>
      </section>

      <section className="shell section" aria-labelledby="featured-heading">
        <div className="section-heading">
          <div><span className="kicker">من الكتالوج</span><h2 id="featured-heading">المنتجات المدرجة</h2></div>
          <Link href="/products" className="subtle-link">عرض جميع المنتجات <span aria-hidden="true">←</span></Link>
        </div>
        {result.error ? (
          <div className="notice" role="status"><strong>تعذر عرض الكتالوج</strong><p>{storeErrorMessage(result.error)}</p></div>
        ) : result.products.length ? (
          <div className="products-grid">{result.products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
        ) : (
          <div className="notice" role="status"><strong>لا توجد منتجات معروضة حاليًا</strong><p>سيظهر هنا أي منتج منشور ومتاح لقناة البيع الخاصة بالمتجر بمجرد إضافته في Medusa.</p></div>
        )}
      </section>

      <section className="shell closing-band">
        <div><span className="kicker">زمزم ستور</span><h2>تجربة تسوّق واضحة من أول تصفح.</h2><p>الصور والمواصفات والأسعار المعروضة مرتبطة بالمنتجات المسجلة في النظام.</p></div>
        <Link className="button button-light" href="/products">تصفح الكتالوج <span aria-hidden="true">←</span></Link>
      </section>
    </main>
  )
}

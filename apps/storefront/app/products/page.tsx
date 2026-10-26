import type { Metadata } from "next"
import Link from "next/link"
import { ProductCard } from "../../components/product-card"
import { listStoreProducts, storeErrorMessage } from "../../lib/medusa"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "المنتجات | زمزم ستور",
  description: "تصفح كتالوج منتجات زمزم ستور وأسعارها المتاحة من نظام المتجر."
}

type SearchParams = { q?: string; page?: string }
const pageSize = 12

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 100) : ""
  const requested = Number(raw.page)
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 1000) : 1
  const result = await listStoreProducts({ limit: pageSize, offset: (page - 1) * pageSize, q })
  const hasNext = page * pageSize < result.count
  const pageUrl = (nextPage: number) => `/products?${new URLSearchParams({
    ...(q ? { q } : {}), page: String(nextPage)
  }).toString()}`

  return (
    <main className="shell catalog-page" id="main-content">
      <nav className="breadcrumbs" aria-label="مسار التنقل"><Link href="/">الرئيسية</Link><span>/</span><span>المنتجات</span></nav>
      <div className="catalog-intro">
        <div><span className="kicker">الكتالوج</span><h1>اكتشف المنتجات</h1><p>البيانات المعروضة تأتي مباشرةً من قائمة المنتجات المنشورة في Medusa.</p></div>
      </div>
      <form className="search-form" action="/products" method="get" role="search">
        <label htmlFor="catalog-search">ابحث عن منتج</label>
        <div className="search-row">
          <input id="catalog-search" name="q" type="search" defaultValue={q} maxLength={100} placeholder="اسم المنتج..." />
          <button type="submit" className="button button-primary">بحث</button>
        </div>
      </form>
      {q ? <p className="search-summary">نتائج البحث عن: <strong>{q}</strong> · <Link href="/products">مسح البحث</Link></p> : null}
      {result.error ? (
        <div className="notice" role="status"><strong>تعذر تحميل المنتجات</strong><p>{storeErrorMessage(result.error)}</p></div>
      ) : result.products.length ? (
        <>
          <p className="result-count">{result.count} منتج مطابق</p>
          <div className="products-grid">{result.products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
          {(page > 1 || hasNext) ? <nav className="pagination" aria-label="صفحات المنتجات">
            {page > 1 ? <Link href={pageUrl(page - 1)} className="button button-secondary">السابق</Link> : null}
            <span>الصفحة {page}</span>
            {hasNext ? <Link href={pageUrl(page + 1)} className="button button-secondary">التالي</Link> : null}
          </nav> : null}
        </>
      ) : (
        <div className="notice" role="status"><strong>لا توجد منتجات مطابقة</strong><p>{q ? "جرّب كلمة بحث مختلفة." : "لم تُنشر منتجات على قناة البيع الحالية بعد."}</p></div>
      )}
    </main>
  )
}

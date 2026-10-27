import Link from "next/link"
import { ProductCard } from "./product-card"
import { listStoreProducts, listStoreCategories, storeErrorMessage } from "../lib/medusa"
import { getDictionary, type Locale } from "../lib/i18n"

type CatalogParams = {
  q?: string
  page?: string
  category?: string
}

const pageSize = 12

export async function CatalogContent({
  searchParams,
  locale = "ar",
}: {
  searchParams: Promise<CatalogParams>
  locale?: Locale
}) {
  const raw = await searchParams
  const dict = getDictionary(locale)
  const isEn = locale === "en"
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 100) : ""
  const selectedCategory = typeof raw.category === "string" ? raw.category.trim() : ""
  const requested = Number(raw.page)
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 1000) : 1

  const basePath = isEn ? "/en/products" : "/products"
  const homePath = isEn ? "/en" : "/"

  // Fetch categories and products in parallel
  const [categoriesResult, productsResult] = await Promise.all([
    listStoreCategories(),
    listStoreProducts({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      q,
      category_id: selectedCategory || undefined,
    }),
  ])

  const categories = categoriesResult.categories
  const hasNext = page * pageSize < productsResult.count

  const buildPageUrl = (targetPage: number) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (selectedCategory) params.set("category", selectedCategory)
    if (targetPage > 1) params.set("page", String(targetPage))
    const queryStr = params.toString()
    return `${basePath}${queryStr ? `?${queryStr}` : ""}`
  }

  const buildCategoryUrl = (catId?: string) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (catId) params.set("category", catId)
    const queryStr = params.toString()
    return `${basePath}${queryStr ? `?${queryStr}` : ""}`
  }

  return (
    <main className="shell catalog-page" id="main-content">
      <nav className="breadcrumbs" aria-label={isEn ? "Breadcrumb" : "مسار التنقل"}>
        <Link href={homePath}>{dict.product.breadcrumbsHome}</Link>
        <span>/</span>
        <span>{dict.product.breadcrumbsProducts}</span>
        {selectedCategory ? (
          <>
            <span>/</span>
            <span>
              {categories.find((c) => c.id === selectedCategory)?.name || selectedCategory}
            </span>
          </>
        ) : null}
      </nav>

      <div className="catalog-intro">
        <div>
          <span className="kicker">{dict.catalog.kicker}</span>
          <h1>{dict.catalog.title}</h1>
          <p>{dict.catalog.description}</p>
        </div>
      </div>

      <form className="search-form" action={basePath} method="get" role="search">
        <label htmlFor="catalog-search">{dict.catalog.searchLabel}</label>
        <div className="search-row">
          <input
            id="catalog-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            placeholder={dict.catalog.searchPlaceholder}
          />
          {selectedCategory ? (
            <input type="hidden" name="category" value={selectedCategory} />
          ) : null}
          <button type="submit" className="button button-primary">
            {dict.catalog.searchButton}
          </button>
        </div>
      </form>

      {categories.length > 0 ? (
        <div className="catalog-categories" aria-label={dict.catalog.filterCategory}>
          <span className="catalog-category-label">{dict.catalog.filterCategory}:</span>
          <div className="catalog-pills">
            <Link
              href={buildCategoryUrl(undefined)}
              className={`catalog-pill ${!selectedCategory ? "active" : ""}`}
            >
              {dict.catalog.allCategories}
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={buildCategoryUrl(cat.id)}
                className={`catalog-pill ${selectedCategory === cat.id ? "active" : ""}`}
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {q ? (
        <p className="search-summary">
          {dict.catalog.searchSummary} <strong>{q}</strong> ·{" "}
          <Link href={basePath}>{dict.catalog.clearSearch}</Link>
        </p>
      ) : null}

      {productsResult.error ? (
        <div className="notice" role="status">
          <strong>{isEn ? "Unable to load products" : "تعذر تحميل المنتجات"}</strong>
          <p>{storeErrorMessage(productsResult.error, locale)}</p>
        </div>
      ) : productsResult.products.length ? (
        <>
          <p className="result-count">{dict.catalog.resultCount(productsResult.count)}</p>
          <div className="products-grid">
            {productsResult.products.map((product) => (
              <ProductCard key={product.id} product={product} locale={locale} />
            ))}
          </div>
          {page > 1 || hasNext ? (
            <nav className="pagination" aria-label={isEn ? "Catalog pagination" : "صفحات المنتجات"}>
              {page > 1 ? (
                <Link href={buildPageUrl(page - 1)} className="button button-secondary">
                  {dict.catalog.paginationPrev}
                </Link>
              ) : null}
              <span>{dict.catalog.pageIndicator(page)}</span>
              {hasNext ? (
                <Link href={buildPageUrl(page + 1)} className="button button-secondary">
                  {dict.catalog.paginationNext}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="notice" role="status">
          <strong>{dict.catalog.noProductsTitle}</strong>
          <p>{q ? dict.catalog.noProductsQuery : dict.catalog.noProductsEmpty}</p>
        </div>
      )}
    </main>
  )
}

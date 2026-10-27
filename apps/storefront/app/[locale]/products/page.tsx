import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ProductCard } from "../../../components/product-card"
import { formatNumber, getDictionary, isLocale, localePath } from "../../../lib/i18n"
import { listStoreCategories, listStoreProducts } from "../../../lib/medusa"
import { localeAlternates } from "../../../lib/site"

export const dynamic = "force-dynamic"

type LocaleParams = { locale: string }
type SearchParams = { q?: string; page?: string; category?: string }

const pageSize = 12

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const dict = getDictionary(locale)
  return {
    title: `${dict.catalog.title} | ${dict.brand.name}`,
    description: dict.catalog.intro,
    alternates: localeAlternates("/products", locale),
  }
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>
  searchParams: Promise<SearchParams>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)
  const catalog = localePath(locale, "/products")
  const raw = await searchParams

  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 100) : ""
  const requestedPage = Number(raw.page)
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000) : 1
  const categoryHandle =
    typeof raw.category === "string" ? raw.category.trim().slice(0, 100) : ""

  const categoriesResult = await listStoreCategories({ limit: 50 })
  const topLevelCategories = categoriesResult.categories.filter(
    (category) => !category.parent_category_id
  )
  const activeCategory = categoryHandle
    ? (categoriesResult.categories.find((category) => category.handle === categoryHandle) ?? null)
    : null
  // An unknown collection only 404s when the category list itself loaded.
  if (categoryHandle && !activeCategory && categoriesResult.error === null) notFound()

  const result = await listStoreProducts({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    q,
    categoryId: activeCategory?.id,
  })

  const totalPages = Math.max(1, Math.ceil(result.count / pageSize))
  const filtered = Boolean(q || activeCategory)

  const hrefFor = (options: { q?: string; category?: string; page?: number } = {}) => {
    const search = new URLSearchParams()
    const nextQ = options.q ?? q
    const nextCategory = options.category ?? categoryHandle
    const nextPage = options.page ?? 1
    if (nextQ) search.set("q", nextQ)
    if (nextCategory) search.set("category", nextCategory)
    if (nextPage > 1) search.set("page", String(nextPage))
    const query = search.toString()
    return query ? `${catalog}?${query}` : catalog
  }

  return (
    <main className="shell catalog-page" id="main-content">
      <nav className="breadcrumbs" aria-label={dict.catalog.breadcrumbLabel}>
        <Link href={localePath(locale, "/")}>{dict.catalog.breadcrumbHome}</Link>
        <span aria-hidden="true">/</span>
        {activeCategory ? (
          <Link href={catalog}>{dict.catalog.breadcrumb}</Link>
        ) : (
          <span>{dict.catalog.breadcrumb}</span>
        )}
        {activeCategory ? (
          <>
            <span aria-hidden="true">/</span>
            <span>{activeCategory.name}</span>
          </>
        ) : null}
      </nav>

      <div className="catalog-intro">
        <div>
          <span className="lux-eyebrow">{dict.catalog.kicker}</span>
          <h1>{activeCategory ? activeCategory.name : dict.catalog.title}</h1>
          <p>{activeCategory?.description?.trim() || dict.catalog.intro}</p>
        </div>
      </div>

      <form className="search-form" action={catalog} method="get" role="search">
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
          {activeCategory ? (
            <input type="hidden" name="category" value={activeCategory.handle} />
          ) : null}
          <button type="submit" className="button button-primary">
            {dict.catalog.searchButton}
          </button>
        </div>
      </form>

      {topLevelCategories.length ? (
        <nav className="lux-filter" aria-label={dict.catalog.categoryFilterLabel}>
          <Link
            className={`lux-filter-link${activeCategory ? "" : " is-active"}`}
            href={hrefFor({ category: "", page: 1 })}
            aria-current={activeCategory ? undefined : "page"}
          >
            {dict.catalog.allCategories}
          </Link>
          {topLevelCategories.map((category) => (
            <Link
              key={category.id}
              className={`lux-filter-link${activeCategory?.id === category.id ? " is-active" : ""}`}
              href={hrefFor({ category: category.handle, page: 1 })}
              aria-current={activeCategory?.id === category.id ? "page" : undefined}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {q ? (
        <p className="search-summary">
          {dict.catalog.resultsFor} <strong>{q}</strong> ·{" "}
          <Link href={hrefFor({ q: "", page: 1 })}>{dict.catalog.clearSearch}</Link>
        </p>
      ) : null}

      {result.error ? (
        <div className="notice" role="status">
          <strong>{dict.catalog.errorTitle}</strong>
          <p>{dict.errors[result.error]}</p>
        </div>
      ) : result.products.length ? (
        <>
          <p className="result-count" role="status">
            {dict.catalog.resultCount(formatNumber(result.count, locale))}
          </p>
          <div className="products-grid">
            {result.products.map((product) => (
              <ProductCard key={product.id} product={product} locale={locale} />
            ))}
          </div>
          {page > 1 || page < totalPages ? (
            <nav className="pagination" aria-label={dict.catalog.breadcrumb}>
              {page > 1 ? (
                <Link href={hrefFor({ page: page - 1 })} className="button button-secondary">
                  {dict.catalog.prev}
                </Link>
              ) : null}
              <span aria-current="page">
                {dict.catalog.pageLabel(formatNumber(page, locale), formatNumber(totalPages, locale))}
              </span>
              {page < totalPages ? (
                <Link href={hrefFor({ page: page + 1 })} className="button button-secondary">
                  {dict.catalog.next}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="notice" role="status">
          <strong>{dict.catalog.emptyTitle}</strong>
          <p>{filtered ? dict.catalog.emptyQuery : dict.catalog.emptyCatalog}</p>
        </div>
      )}
    </main>
  )
}


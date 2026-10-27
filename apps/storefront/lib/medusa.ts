/**
 * Read-only Medusa Store API adapter.
 *
 * All displayed products, categories, prices and media come from Medusa; no
 * invented inventory, prices, stock status or classification.
 *
 * Medusa only populates `variants.calculated_price` when the request carries a
 * pricing context (`region_id`). Without one the API either falls back to an
 * arbitrary region or rejects the request, so the adapter resolves the EGP
 * region explicitly and refuses to display amounts that are not EGP.
 */
import type { Locale } from "./i18n"

export type StorePrice = {
  calculated_amount?: number | null
  currency_code?: string | null
}

export type StoreVariant = {
  id: string
  title?: string | null
  sku?: string | null
  calculated_price?: StorePrice | null
}

export type StoreImage = { id: string; url: string }

export type StoreCategory = {
  id: string
  name: string
  handle: string
  description?: string | null
  parent_category_id?: string | null
  rank?: number | null
}

export type StoreProduct = {
  id: string
  handle: string
  title: string
  subtitle?: string | null
  description?: string | null
  thumbnail?: string | null
  images?: StoreImage[]
  variants?: StoreVariant[]
}

export type StoreError = "configuration" | "connection" | "response" | null

export type StoreListResult = {
  products: StoreProduct[]
  count: number
  error: StoreError
}

export type StoreCategoryResult = {
  categories: StoreCategory[]
  count: number
  error: StoreError
}

export type ProductQueryOptions = {
  limit?: number
  offset?: number
  q?: string
  handle?: string
  categoryId?: string
  regionId?: string | null
}

export type CategoryQueryOptions = {
  limit?: number
  offset?: number
  handle?: string
  parentCategoryId?: string
}

const PRODUCT_FIELDS = "+variants.sku,+images"
const CATEGORY_FIELDS = "id,name,handle,description,parent_category_id,rank"
const REQUEST_TIMEOUT_MS = 8000
const REGION_TTL_MS = 5 * 60 * 1000
const REGION_FAILURE_TTL_MS = 30 * 1000

export function storeBase(): string | null {
  const raw = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  if (!raw) return null
  try {
    new URL(raw)
    return raw.replace(/\/+$/, "")
  } catch {
    return null
  }
}

export function storeKey(): string | null {
  const key = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  return key?.trim() ? key.trim() : null
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(Math.max(numeric, min), max)
}

/** Search parameters for `GET /store/products`, exactly as Medusa validates them. */
export function buildProductQuery(options: ProductQueryOptions = {}): URLSearchParams {
  const params = new URLSearchParams()
  params.set("limit", String(clampInteger(options.limit, 12, 1, 100)))
  params.set("offset", String(clampInteger(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)))
  const fields = options.regionId ? `${PRODUCT_FIELDS},+variants.calculated_price` : PRODUCT_FIELDS
  params.set("fields", fields)
  const term = options.q?.trim().slice(0, 100)
  if (term) params.set("q", term)
  if (options.handle?.trim()) params.set("handle", options.handle.trim())
  if (options.categoryId?.trim()) params.set("category_id", options.categoryId.trim())
  // Prices are only requested alongside an explicit region, so a missing region
  // degrades to "price unavailable" instead of an arbitrary currency.
  if (options.regionId) params.set("region_id", options.regionId)
  return params
}

/** Search parameters for `GET /store/product-categories`. */
export function buildCategoryQuery(options: CategoryQueryOptions = {}): URLSearchParams {
  const params = new URLSearchParams()
  params.set("limit", String(clampInteger(options.limit, 50, 1, 100)))
  params.set("offset", String(clampInteger(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)))
  params.set("fields", CATEGORY_FIELDS)
  if (options.handle?.trim()) params.set("handle", options.handle.trim())
  if (options.parentCategoryId?.trim()) {
    params.set("parent_category_id", options.parentCategoryId.trim())
  }
  return params
}

let egpRegionCache: { id: string | null; expires: number } | null = null

/** Test seam: drop the cached EGP region between cases. */
export function resetStoreCache(): void {
  egpRegionCache = null
}

async function fetchJson(endpoint: URL): Promise<unknown> {
  const key = storeKey()
  if (!key) throw new Error("missing publishable key")
  const response = await fetch(endpoint.toString(), {
    headers: { "x-publishable-api-key": key, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) return null
  return response.json()
}

/**
 * Resolve the store region priced in EGP. `MEDUSA_REGION_ID` overrides the
 * lookup for stores with several EGP regions.
 */
export async function resolveEgpRegionId(): Promise<string | null> {
  const configured = process.env.MEDUSA_REGION_ID?.trim()
  if (configured) return configured

  const now = Date.now()
  if (egpRegionCache && egpRegionCache.expires > now) return egpRegionCache.id

  const base = storeBase()
  let resolved: string | null = null
  if (base) {
    try {
      const endpoint = new URL(`${base}/store/regions`)
      endpoint.searchParams.set("currency_code", "egp")
      endpoint.searchParams.set("limit", "1")
      endpoint.searchParams.set("fields", "id,currency_code")
      const payload = await fetchJson(endpoint)
      const regions = (payload as { regions?: unknown } | null)?.regions
      if (Array.isArray(regions)) {
        const match = regions.find((region) => {
          if (!region || typeof region !== "object") return false
          const candidate = region as { id?: unknown; currency_code?: unknown }
          return (
            typeof candidate.id === "string" &&
            typeof candidate.currency_code === "string" &&
            candidate.currency_code.toLowerCase() === "egp"
          )
        }) as { id?: string } | undefined
        resolved = typeof match?.id === "string" ? match.id : null
      }
    } catch {
      resolved = null
    }
  }

  egpRegionCache = {
    id: resolved,
    expires: now + (resolved ? REGION_TTL_MS : REGION_FAILURE_TTL_MS),
  }
  return resolved
}

/** Only absolute HTTP(S) or same-origin paths are renderable; anything else is dropped. */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("/")) return trimmed
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed
  return null
}

function toVariant(value: unknown): StoreVariant | null {
  if (!value || typeof value !== "object") return null
  const variant = value as Record<string, unknown>
  if (typeof variant.id !== "string") return null
  const rawPrice = variant.calculated_price
  let calculatedPrice: StorePrice | null = null
  if (rawPrice && typeof rawPrice === "object") {
    const price = rawPrice as Record<string, unknown>
    calculatedPrice = {
      calculated_amount:
        typeof price.calculated_amount === "number" && Number.isFinite(price.calculated_amount)
          ? price.calculated_amount
          : null,
      currency_code: typeof price.currency_code === "string" ? price.currency_code : null,
    }
  }
  return {
    id: variant.id,
    title: typeof variant.title === "string" ? variant.title : null,
    sku: typeof variant.sku === "string" ? variant.sku : null,
    calculated_price: calculatedPrice,
  }
}

function toProduct(value: unknown): StoreProduct | null {
  if (!value || typeof value !== "object") return null
  const product = value as Record<string, unknown>
  if (
    typeof product.id !== "string" ||
    typeof product.handle !== "string" ||
    !product.handle.trim() ||
    typeof product.title !== "string" ||
    !product.title.trim()
  ) {
    return null
  }

  const images: StoreImage[] = []
  if (Array.isArray(product.images)) {
    for (const entry of product.images) {
      if (!entry || typeof entry !== "object") continue
      const image = entry as Record<string, unknown>
      const url = safeImageUrl(image.url)
      if (!url) continue
      images.push({ id: typeof image.id === "string" ? image.id : url, url })
    }
  }

  const variants: StoreVariant[] = []
  if (Array.isArray(product.variants)) {
    for (const entry of product.variants) {
      const variant = toVariant(entry)
      if (variant) variants.push(variant)
    }
  }

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    subtitle: typeof product.subtitle === "string" ? product.subtitle : null,
    description: typeof product.description === "string" ? product.description : null,
    thumbnail: safeImageUrl(product.thumbnail),
    images,
    variants,
  }
}

function toCategory(value: unknown): StoreCategory | null {
  if (!value || typeof value !== "object") return null
  const category = value as Record<string, unknown>
  if (
    typeof category.id !== "string" ||
    typeof category.name !== "string" ||
    !category.name.trim() ||
    typeof category.handle !== "string" ||
    !category.handle.trim()
  ) {
    return null
  }
  return {
    id: category.id,
    name: category.name,
    handle: category.handle,
    description: typeof category.description === "string" ? category.description : null,
    parent_category_id:
      typeof category.parent_category_id === "string" ? category.parent_category_id : null,
    rank: typeof category.rank === "number" ? category.rank : null,
  }
}

function countOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

export async function listStoreProducts(
  options: ProductQueryOptions = {}
): Promise<StoreListResult> {
  const base = storeBase()
  if (!base || !storeKey()) return { products: [], count: 0, error: "configuration" }

  const regionId = await resolveEgpRegionId()

  try {
    const endpoint = new URL(`${base}/store/products`)
    endpoint.search = buildProductQuery({ ...options, regionId }).toString()
    const payload = await fetchJson(endpoint)
    if (!payload || typeof payload !== "object") {
      return { products: [], count: 0, error: "response" }
    }
    const data = payload as { products?: unknown; count?: unknown }
    if (!Array.isArray(data.products)) return { products: [], count: 0, error: "response" }

    // Medusa owns visibility filtering through the publishable key/sales channel.
    const products = data.products
      .map(toProduct)
      .filter((product): product is StoreProduct => product !== null)

    return {
      products,
      count: countOrFallback(data.count, products.length),
      error: null,
    }
  } catch {
    return { products: [], count: 0, error: "connection" }
  }
}

export async function listStoreCategories(
  options: CategoryQueryOptions = {}
): Promise<StoreCategoryResult> {
  const base = storeBase()
  if (!base || !storeKey()) return { categories: [], count: 0, error: "configuration" }

  try {
    const endpoint = new URL(`${base}/store/product-categories`)
    endpoint.search = buildCategoryQuery(options).toString()
    const payload = await fetchJson(endpoint)
    if (!payload || typeof payload !== "object") {
      return { categories: [], count: 0, error: "response" }
    }
    const data = payload as { product_categories?: unknown; count?: unknown }
    if (!Array.isArray(data.product_categories)) {
      return { categories: [], count: 0, error: "response" }
    }
    const categories = data.product_categories
      .map(toCategory)
      .filter((category): category is StoreCategory => category !== null)
    return {
      categories,
      count: countOrFallback(data.count, categories.length),
      error: null,
    }
  } catch {
    return { categories: [], count: 0, error: "connection" }
  }
}

/**
 * Prices returned by the Medusa Store API are in major currency units.
 * Never silently round a fractional piastre or present a non-EGP amount.
 */
function egpAmount(variant: StoreVariant): number | null {
  const price = variant.calculated_price
  const amount = price?.calculated_amount
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    price?.currency_code?.toLowerCase() !== "egp"
  ) {
    return null
  }
  const piastres = amount * 100
  return Math.abs(piastres - Math.round(piastres)) < 1e-7 ? amount : null
}

const priceLocales: Record<Locale, string> = { ar: "ar-EG", en: "en-EG" }

export function formatVariantPrice(variant: StoreVariant, locale: Locale = "ar"): string | null {
  const amount = egpAmount(variant)
  if (amount === null) return null
  return new Intl.NumberFormat(priceLocales[locale] ?? priceLocales.ar, {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Lowest validated EGP amount for a product, or null when no variant is priced. */
export function productPriceAmount(product: StoreProduct): number | null {
  const variants = product.variants ?? []
  if (
    variants.some(
      (variant) =>
        variant.calculated_price?.currency_code &&
        variant.calculated_price.currency_code.toLowerCase() !== "egp"
    )
  ) {
    return null
  }
  const amounts = variants
    .map((variant) => egpAmount(variant))
    .filter((amount): amount is number => amount !== null)
  return amounts.length ? Math.min(...amounts) : null
}

export function displayPrice(product: StoreProduct, locale: Locale = "ar"): string | null {
  const variants = product.variants ?? []
  // Never mix or conceal prices explicitly quoted in other currencies.
  if (
    variants.some(
      (variant) =>
        variant.calculated_price?.currency_code &&
        variant.calculated_price.currency_code.toLowerCase() !== "egp"
    )
  ) {
    return null
  }
  const priced = variants
    .map((variant) => ({ variant, amount: egpAmount(variant) }))
    .filter((entry): entry is { variant: StoreVariant; amount: number } => entry.amount !== null)
  if (!priced.length) return null
  const lowest = priced.reduce((current, next) => (next.amount < current.amount ? next : current))
  return formatVariantPrice(lowest.variant, locale)
}


/**
 * Resolves the selected variant ID from a raw URL parameter value.
 * Strictly validates that the variant ID exists in the product's variants.
 * Falls back to the first available variant ID if missing or unrecognized.
 */
export function resolveSelectedVariantId(
  variants: StoreVariant[],
  rawVariantParam: string | null | undefined
): string {
  if (!variants || variants.length === 0) return ""
  if (typeof rawVariantParam === "string" && rawVariantParam.trim()) {
    const trimmed = rawVariantParam.trim()
    const match = variants.find((v) => v.id === trimmed)
    if (match) return match.id
  }
  return variants[0]?.id ?? ""
}

/**
 * Builds Schema.org Product structured data.
 *
 * DEF-06:
 * While customer purchasing is disabled, does NOT emit an unsupported `Offer`.
 * Emits truthful metadata: name, description, image, and SKU.
 * Never invents stock availability, prices, or checkout URLs.
 */
export function buildProductStructuredData(
  product: StoreProduct,
  options: { siteUrl?: string; isPurchasingEnabled?: boolean } = {}
): Record<string, unknown> {
  const images = productImageUrls(product)
  const mainImage = images[0]
  const singleSku =
    (product.variants ?? []).length === 1 ? (product.variants?.[0]?.sku?.trim() ?? "") : ""

  const structured: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
  }

  if (product.description?.trim()) {
    structured.description = product.description.trim()
  }

  if (mainImage) {
    let fullImageUrl = mainImage
    try {
      fullImageUrl = new URL(mainImage, options.siteUrl || "http://localhost:8000").toString()
    } catch {
      fullImageUrl = mainImage
    }
    structured.image = [fullImageUrl]
  }

  if (singleSku) {
    structured.sku = singleSku
  }

  // Strictly gated: only emit offers when purchasing is enabled
  if (options.isPurchasingEnabled) {
    const priceAmount = productPriceAmount(product)
    if (priceAmount !== null) {
      structured.offers = {
        "@type": "Offer",
        price: priceAmount.toFixed(2),
        priceCurrency: "EGP",
      }
    }
  }

  return structured
}

export function productImageUrls(product: StoreProduct): string[] {
  const urls = [product.thumbnail, ...(product.images ?? []).map((image) => image.url)]
    .map(safeImageUrl)
    .filter((url): url is string => url !== null)
  return urls.filter((url, index) => urls.indexOf(url) === index)
}

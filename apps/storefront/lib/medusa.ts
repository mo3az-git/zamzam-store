/**
 * Read-only Medusa Store API adapter.
 * All displayed products come from Medusa; no invented inventory, prices or stock status.
 */
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

export type StoreProduct = {
  id: string
  handle: string
  title: string
  subtitle?: string | null
  description?: string | null
  thumbnail?: string | null
  images?: Array<{ id: string; url: string }>
  variants?: StoreVariant[]
}

export type StoreListResult = {
  products: StoreProduct[]
  count: number
  error: "configuration" | "connection" | "response" | null
}

const configuredBase = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

export async function listStoreProducts(options: {
  limit?: number
  offset?: number
  q?: string
  handle?: string
} = {}): Promise<StoreListResult> {
  if (!configuredBase || !publishableKey) {
    return { products: [], count: 0, error: "configuration" }
  }

  try {
    const endpoint = new URL("/store/products", configuredBase)
    endpoint.searchParams.set("limit", String(Math.min(Math.max(options.limit ?? 12, 1), 100)))
    endpoint.searchParams.set("offset", String(Math.max(options.offset ?? 0, 0)))
    endpoint.searchParams.set("fields", "+variants.calculated_price,+variants.sku,+images")
    if (options.q?.trim()) endpoint.searchParams.set("q", options.q.trim().slice(0, 100))
    if (options.handle) endpoint.searchParams.set("handle", options.handle)

    const response = await fetch(endpoint.toString(), {
      headers: { "x-publishable-api-key": publishableKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) return { products: [], count: 0, error: "response" }
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== "object") return { products: [], count: 0, error: "response" }
    const data = payload as { products?: unknown; count?: unknown }
    if (!Array.isArray(data.products)) return { products: [], count: 0, error: "response" }

    // Medusa owns visibility filtering through the publishable key/sales channel.
    return {
      products: data.products as StoreProduct[],
      count: typeof data.count === "number" ? data.count : data.products.length,
      error: null,
    }
  } catch {
    return { products: [], count: 0, error: "connection" }
  }
}

/**
 * Prices returned by the Medusa Store API are in major currency units.
 * Never silently round a fractional piastre or present a non-EGP amount.
 */
function egpAmount(variant: StoreVariant): number | null {
  const price = variant.calculated_price
  const amount = price?.calculated_amount
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 ||
      price?.currency_code?.toLowerCase() !== "egp") return null
  const piastres = amount * 100
  return Math.abs(piastres - Math.round(piastres)) < 1e-7 ? amount : null
}

export function formatVariantPrice(variant: StoreVariant): string | null {
  const amount = egpAmount(variant)
  if (amount === null) return null
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function displayPrice(product: StoreProduct): string | null {
  const variants = product.variants ?? []
  // Never mix or conceal prices explicitly quoted in other currencies.
  if (variants.some((variant) => variant.calculated_price?.currency_code &&
      variant.calculated_price.currency_code.toLowerCase() !== "egp")) return null
  const priced = variants.map((variant) => ({ variant, amount: egpAmount(variant) }))
    .filter((entry): entry is { variant: StoreVariant; amount: number } => entry.amount !== null)
  if (!priced.length) return null
  return formatVariantPrice(priced.reduce((lowest, current) =>
    current.amount < lowest.amount ? current : lowest).variant)
}

export function storeErrorMessage(error: StoreListResult["error"]): string {
  if (error === "configuration") return "لم يتم إعداد اتصال المتجر بالمنتجات بعد. أضف رابط Medusa ومفتاح النشر إلى إعدادات الواجهة."
  if (error === "connection") return "تعذر الاتصال بخدمة المنتجات حاليًا. يرجى المحاولة لاحقًا."
  return "تعذر تحميل المنتجات من النظام. يرجى المحاولة لاحقًا."
}

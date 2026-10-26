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
    endpoint.searchParams.set("fields", "+variants.calculated_price,+images")
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

export function displayPrice(product: StoreProduct): string | null {
  const prices = (product.variants ?? [])
    .map((variant) => variant.calculated_price)
    .filter((price): price is StorePrice => price != null &&
      typeof price.calculated_amount === "number" &&
      Number.isFinite(price.calculated_amount) &&
      typeof price.currency_code === "string")

  if (!prices.length) return null
  const currency = prices[0].currency_code!
  // Do not combine prices from different currencies or assume a missing regional price.
  if (prices.some((price) => price.currency_code !== currency)) return null
  const lowest = Math.min(...prices.map((price) => price.calculated_amount!))

  try {
    return new Intl.NumberFormat("ar-EG", {
      style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2,
    }).format(lowest)
  } catch {
    return null
  }
}

export function storeErrorMessage(error: StoreListResult["error"]): string {
  if (error === "configuration") return "لم يتم إعداد اتصال المتجر بالمنتجات بعد. أضف رابط Medusa ومفتاح النشر إلى إعدادات الواجهة."
  if (error === "connection") return "تعذر الاتصال بخدمة المنتجات حاليًا. يرجى المحاولة لاحقًا."
  return "تعذر تحميل المنتجات من النظام. يرجى المحاولة لاحقًا."
}

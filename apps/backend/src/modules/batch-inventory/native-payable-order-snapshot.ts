import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type Row = Record<string, unknown>
type Sql = {
  raw(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>
}
export class NativePayableSnapshotError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "NativePayableSnapshotError" }
}
const fail = (code: string): never => { throw new NativePayableSnapshotError(code) }

/** Medusa v2 raw money is a major-unit decimal string. No floating-point conversion. */
export function normalizeEgpTotal(raw: unknown, allowZero = false) {
  const value = raw && typeof raw === "object" && "value" in raw ? (raw as Row).value : undefined
  if (typeof value !== "string" || value.length > 100 || !/^\d+(?:\.\d+)?$/.test(value)) {
    return fail("NATIVE_TOTAL_RAW_INVALID")
  }
  const [whole, fraction = ""] = value.split(".")
  if (fraction.slice(2).replace(/0/g, "") !== "") return fail("NATIVE_TOTAL_FRACTIONAL_MINOR_UNIT")
  const minor = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))
  if (minor === 0n && !allowZero) return fail("NATIVE_TOTAL_NOT_POSITIVE")
  return { major: `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`, minor: minor.toString() }
}

type Expected = { cartId: string; orderId: string; expectedVersion?: number; expectedTotalMinor?: string }
/**
 * Trusted, read-only boundary for the payment coordinator. It verifies the
 * native link and snapshots the current native order under the order advisory
 * root; callers must revalidate under that root when committing later writes.
 */
export async function readNativePayableOrderSnapshot(container: MedusaContainer, expected: Expected) {
  if (!expected.cartId || !expected.orderId) return fail("INVALID_NATIVE_ORDER_IDENTITY")
  if (expected.expectedVersion !== undefined &&
      (!Number.isSafeInteger(expected.expectedVersion) || expected.expectedVersion < 1)) return fail("INVALID_EXPECTED_VERSION")
  if (expected.expectedTotalMinor !== undefined && !/^[1-9]\d*$/.test(expected.expectedTotalMinor)) return fail("INVALID_EXPECTED_TOTAL")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Sql
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as {
    graph(input: Row): Promise<{ data: Row[] }>
  }
  return db.transaction(async (tx) => {
    await tx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", ["phase0:order:" + expected.orderId])
    const readLinks = async () => (await tx.raw(`SELECT oc.order_id,oc.cart_id FROM order_cart oc
      INNER JOIN "order" o ON o.id=oc.order_id AND o.deleted_at IS NULL
      WHERE oc.cart_id=? OR oc.order_id=? ORDER BY oc.order_id,oc.cart_id`, [expected.cartId, expected.orderId])).rows
    const links = await readLinks()
    if (links.length !== 1 || links[0].order_id !== expected.orderId || links[0].cart_id !== expected.cartId) {
      return fail("ORDER_CART_ASSOCIATION_MISMATCH")
    }
    const read = async () => {
      // Medusa computes raw_total only when the calculated total is selected.
      const result = await query.graph({ entity: "order", fields: ["id", "version", "currency_code", "total", "raw_total",
        "items.id", "items.variant_id", "items.metadata", "items.raw_unit_price", "items.detail.quantity"],
      filters: { id: expected.orderId } })
      if (result.data.length !== 1) return fail("NATIVE_ORDER_NOT_FOUND")
      const order = result.data[0]
      const version = Number(order.version)
      if (order.id !== expected.orderId || !Number.isSafeInteger(version) || version < 1) return fail("NATIVE_ORDER_VERSION_INVALID")
      if (String(order.currency_code).toLowerCase() !== "egp") return fail("NATIVE_ORDER_CURRENCY_MISMATCH")
      const total = normalizeEgpTotal(order.raw_total)
      if (!Array.isArray(order.items) || !order.items.length) return fail("NATIVE_ORDER_LINES_INVALID")
      const seen = new Set<string>()
      const lines = (order.items as Row[]).map((line) => {
        const metadata = line.metadata as Row | null
        const detail = line.detail as Row | null
        const key = metadata?.checkout_line_key
        const rawPrice = line.raw_unit_price as Row | null
        const quantity = Number(detail?.quantity)
        if (typeof line.id !== "string" || typeof line.variant_id !== "string" ||
          typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ||
          seen.has(key) || !Number.isSafeInteger(quantity) || quantity < 1 ||
          typeof rawPrice?.value !== "string") return fail("NATIVE_ORDER_LINES_INVALID")
        seen.add(key)
        return { lineId: line.id, variantId: line.variant_id, checkoutLineKey: key,
          quantity, rawUnitPriceMajor: rawPrice.value }
      }).sort((a, b) => a.lineId.localeCompare(b.lineId))
      return { orderId: expected.orderId, cartId: expected.cartId, currency: "egp" as const,
        orderVersion: version, totalMajor: total.major, totalMinor: total.minor, lines }
    }
    const first = await read()
    const second = await read()
    if (JSON.stringify(first) !== JSON.stringify(second)) return fail("NATIVE_ORDER_CHANGED_DURING_READ")
    if (JSON.stringify(links) !== JSON.stringify(await readLinks())) return fail("ORDER_CART_ASSOCIATION_MISMATCH")
    if (expected.expectedVersion !== undefined && expected.expectedVersion !== first.orderVersion) return fail("NATIVE_ORDER_VERSION_CONFLICT")
    if (expected.expectedTotalMinor !== undefined && expected.expectedTotalMinor !== first.totalMinor) return fail("NATIVE_ORDER_TOTAL_CONFLICT")
    return first
  })
}

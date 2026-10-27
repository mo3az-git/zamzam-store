import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  addToCartWorkflow,
  addToCartWorkflowId,
  updateLineItemInCartWorkflow,
  updateLineItemInCartWorkflowId,
  updateCartWorkflow,
  updateCartWorkflowId,
} from "@medusajs/medusa/core-flows"
import { isVerifiedGuestCartOwnership } from "./guest-cart-ownership"
import { createCartBffGuestOwnershipAdapter } from "./cart-bff-guest-ownership"
import { normalizeEgpTotal } from "./native-payable-order-snapshot"
import { evaluateGuestCheckoutPreflight } from "./guest-checkout-preflight"
import { getGovernorateShippingBlockers, resolveEgyptianGovernorateId, resolveEgyptianMedusaProvinceCode } from "./egypt-shipping-configuration"
import type { CartBffDependencies, CartOrchestrationSnapshot, GuestCartAuthority } from "./cart-bff-orchestrator"
import type { CartBffBlocker, CartBffDelivery, CartBffSnapshot } from "./cart-bff-contract"

type Row = Record<string, unknown>
type Sql = {
  raw(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number }>
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>
}
type Query = { graph(input: Row): Promise<{ data: Row[] }> }
type WorkflowEngine = { run(id: string, input: Row): Promise<unknown> }
type Locking = { execute<T>(key: string, callback: () => Promise<T>, options?: Row): Promise<T> }
type HttpResponse = { cookie(name: string, value: string, options: Row): unknown }

export class CartBffRuntimeError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CartBffRuntimeError" }
}

const dbFor = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Sql
const queryFor = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query
const versionToken = (version: unknown) => "v" + String(version)
const asRow = (value: unknown): Row => value && typeof value === "object" ? value as Row : {}
const rawDecimal = (value: unknown, allowZero = true): string => {
  const normalized = normalizeEgpTotal(value, allowZero)
  return normalized.major
}
const rawMoney = (value: unknown): { currency: "egp"; amount: string } => ({ currency: "egp", amount: rawDecimal(value) })

function nativeFingerprint(cart: Row): string {
  const items = Array.isArray(cart.items) ? cart.items.map((item) => {
    const line = asRow(item)
    return [line.id, line.variant_id, line.quantity, line.raw_unit_price, line.raw_total]
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : []
  const updatedAt = cart.updated_at instanceof Date ? cart.updated_at.toISOString() : String(cart.updated_at ?? "")
  return createHash("sha256").update(JSON.stringify({
    id: cart.id, updatedAt, currency: cart.currency_code, subtotal: cart.raw_subtotal,
    shipping: cart.raw_shipping_total, total: cart.raw_total, items,
    email: cart.email, shippingAddress: cart.shipping_address,
  })).digest("hex")
}

async function findNativeCart(container: MedusaContainer, cartId: string): Promise<Row> {
  const result = await queryFor(container).graph({
    entity: "cart",
    fields: [
      "id", "updated_at", "completed_at", "currency_code", "region_id", "region.id",
      "region.currency_code", "region.countries.iso_2", "email", "shipping_address.*",
      "shipping_methods.id", "shipping_methods.amount", "shipping_methods.raw_amount",
      "subtotal", "raw_subtotal", "shipping_total", "raw_shipping_total", "total", "raw_total",
      "items.id", "items.variant_id", "items.title", "items.quantity", "items.raw_unit_price",
      "items.raw_total",
    ],
    filters: { id: cartId },
  })
  if (result.data.length !== 1 || result.data[0].id !== cartId) throw new CartBffRuntimeError("CART_UNAVAILABLE")
  return result.data[0]
}

async function reconcileVersion(db: Sql, cartId: string, fingerprint: string): Promise<number> {
  return db.transaction(async (tx) => {
    let row = (await tx.raw("SELECT version,native_fingerprint,pending_request_id FROM cart_bff_state WHERE cart_id=? FOR UPDATE", [cartId])).rows[0]
    if (!row) {
      await tx.raw("INSERT INTO cart_bff_state(cart_id,version,native_fingerprint) VALUES(?,1,?) ON CONFLICT (cart_id) DO NOTHING", [cartId, fingerprint])
      row = (await tx.raw("SELECT version,native_fingerprint,pending_request_id FROM cart_bff_state WHERE cart_id=? FOR UPDATE", [cartId])).rows[0]
    }
    if (!row) throw new CartBffRuntimeError("CART_UNAVAILABLE")
    let version = Number(row.version)
    if (!Number.isSafeInteger(version) || version < 1) throw new CartBffRuntimeError("CART_UNAVAILABLE")
    if (row.pending_request_id) {
      // The workflow hook advanced the version while holding Medusa's native
      // cart lock. A pending marker is reconciled without a second increment.
      await tx.raw("UPDATE cart_bff_state SET native_fingerprint=?,pending_request_id=NULL,updated_at=now() WHERE cart_id=?", [fingerprint, cartId])
    } else if (row.native_fingerprint !== fingerprint) {
      version += 1
      await tx.raw("UPDATE cart_bff_state SET version=?,native_fingerprint=?,updated_at=now() WHERE cart_id=?", [version, fingerprint, cartId])
    }
    return version
  })
}

function addressToDelivery(cart: Row): { delivery: CartBffDelivery | null; governorateId: string | null } {
  const address = asRow(cart.shipping_address)
  if (!address.address_1) return { delivery: null, governorateId: null }
  const governorate = resolveEgyptianMedusaProvinceCode(address.province_code ?? address.province)
  if (!governorate || String(address.country_code).toLowerCase() !== "eg") return { delivery: null, governorateId: null }
  const delivery: CartBffDelivery = {
    email: String(cart.email ?? ""), firstName: String(address.first_name ?? ""), lastName: String(address.last_name ?? ""),
    phone: String(address.phone ?? ""), governorateId: governorate.id, city: String(address.city ?? ""),
    address1: String(address.address_1),
    ...(typeof address.address_2 === "string" && address.address_2 ? { address2: address.address_2 } : {}),
    ...(typeof address.postal_code === "string" && address.postal_code ? { postalCode: address.postal_code } : {}),
    ...(typeof asRow(address.metadata).delivery_notes === "string" ? { notes: String(asRow(address.metadata).delivery_notes) } : {}),
  }
  return { delivery, governorateId: governorate.id }
}

async function toSnapshot(container: MedusaContainer, cart: Row): Promise<CartOrchestrationSnapshot> {
  if (String(cart.currency_code).toLowerCase() !== "egp" || String(asRow(cart.region).currency_code).toLowerCase() !== "egp" ||
      !(Array.isArray(asRow(cart.region).countries) && (asRow(cart.region).countries as Row[]).some((c) => String(c.iso_2).toLowerCase() === "eg"))) {
    throw new CartBffRuntimeError("CART_REGION_NOT_EGYPT_EGP")
  }
  const items = Array.isArray(cart.items) ? cart.items as Row[] : []
  const address = addressToDelivery(cart)
  const version = await reconcileVersion(dbFor(container), String(cart.id), nativeFingerprint(cart))
  const lines = items.map((item) => ({ variantId: String(item.variant_id ?? ""), minShelfLifeDays: null }))
  const snapshot: CartBffSnapshot = {
    version: versionToken(version), currency: "egp",
    items: items.map((item) => ({
      lineItemId: String(item.id), variantId: String(item.variant_id), title: typeof item.title === "string" ? item.title : null,
      quantity: Number(item.quantity), unitPrice: rawMoney(item.raw_unit_price), total: rawMoney(item.raw_total), availability: "unknown",
    })),
    subtotal: rawMoney(cart.raw_subtotal),
    shipping: Array.isArray(cart.shipping_methods) && cart.shipping_methods.length ? rawMoney(cart.raw_shipping_total) : null,
    total: rawMoney(cart.raw_total), delivery: address.delivery,
  }
  return { version: snapshot.version, native: cart, public: snapshot, lines, governorateId: address.governorateId }
}

type MutationPermit = Readonly<{ v: 1; cartId: string; expectedVersion: string; ownerKey: string; requestId: string; signature: string }>
const signingSecret = () => process.env.COOKIE_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-only-cookie-secret-do-not-use-in-production")
function signPermit(value: Omit<MutationPermit, "signature">): MutationPermit {
  const secret = signingSecret()
  if (secret.length < 32) throw new CartBffRuntimeError("UPSTREAM_UNAVAILABLE")
  const signature = createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex")
  return { ...value, signature }
}
function verifyPermit(value: unknown): MutationPermit | null {
  const permit = asRow(value)
  if (permit.v !== 1 || typeof permit.cartId !== "string" || typeof permit.expectedVersion !== "string" ||
      typeof permit.ownerKey !== "string" || !/^[a-f0-9]{64}$/.test(permit.ownerKey) ||
      typeof permit.requestId !== "string" || typeof permit.signature !== "string" || !/^[a-f0-9]{64}$/.test(permit.signature)) return null
  const unsigned = { v: 1 as const, cartId: permit.cartId, expectedVersion: permit.expectedVersion, ownerKey: permit.ownerKey, requestId: permit.requestId }
  const secret = signingSecret()
  if (secret.length < 32) return null
  const expected = createHmac("sha256", secret).update(JSON.stringify(unsigned)).digest()
  const actual = Buffer.from(permit.signature, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? { ...unsigned, signature: permit.signature } : null
}

async function beginMutation(container: MedusaContainer, cart: Row, permit: MutationPermit): Promise<void> {
  const db = dbFor(container)
  const fingerprint = nativeFingerprint(cart)
  await db.transaction(async (tx) => {
    const owner = (await tx.raw(`SELECT session_hash FROM guest_cart_ownership
      WHERE session_hash=? AND cart_id=? AND invalidated_at IS NULL AND expires_at>now() FOR SHARE`, [permit.ownerKey, permit.cartId])).rows
    if (owner.length !== 1 || cart.id !== permit.cartId) throw new CartBffRuntimeError("CART_UNAVAILABLE")
    const checkout = (await tx.raw("SELECT status FROM cart_checkout_session WHERE cart_id=? AND deleted_at IS NULL", [permit.cartId])).rows[0]
    if (checkout?.status === "in_progress") throw new CartBffRuntimeError("CART_MUTATIONS_LOCKED")
    if (checkout?.status === "completed" || cart.completed_at) throw new CartBffRuntimeError("CART_ALREADY_COMPLETED")
    let row = (await tx.raw("SELECT version,native_fingerprint,pending_request_id FROM cart_bff_state WHERE cart_id=? FOR UPDATE", [permit.cartId])).rows[0]
    if (!row) {
      await tx.raw("INSERT INTO cart_bff_state(cart_id,version,native_fingerprint) VALUES(?,1,?) ON CONFLICT (cart_id) DO NOTHING", [permit.cartId, fingerprint])
      row = (await tx.raw("SELECT version,native_fingerprint,pending_request_id FROM cart_bff_state WHERE cart_id=? FOR UPDATE", [permit.cartId])).rows[0]
    }
    if (!row) throw new CartBffRuntimeError("CART_UNAVAILABLE")
    let version = Number(row.version)
    if (row.pending_request_id) {
      await tx.raw("UPDATE cart_bff_state SET native_fingerprint=?,pending_request_id=NULL WHERE cart_id=?", [fingerprint, permit.cartId])
    } else if (row.native_fingerprint !== fingerprint) {
      version += 1
      await tx.raw("UPDATE cart_bff_state SET version=?,native_fingerprint=? WHERE cart_id=?", [version, fingerprint, permit.cartId])
    }
    if (permit.expectedVersion !== versionToken(version)) throw new CartBffRuntimeError("CART_VERSION_CONFLICT")
    await tx.raw("UPDATE cart_bff_state SET version=?,pending_request_id=?,updated_at=now() WHERE cart_id=?", [version + 1, permit.requestId, permit.cartId])
  })
}

let hooksInstalled = false
function installVersionHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  const validate = async (event: { input?: Row; cart?: Row }, context: { container: MedusaContainer }) => {
    const additional = asRow(event.input?.additional_data)
    if (!("zamzam_cart_bff" in additional)) return
    const permit = verifyPermit(additional.zamzam_cart_bff)
    const cart = asRow(event.cart)
    if (!permit || !cart.id || cart.id !== permit.cartId) throw new CartBffRuntimeError("CART_UNAVAILABLE")
    const native = await findNativeCart(context.container, permit.cartId)
    await beginMutation(context.container, native, permit)
  }
  const hookable = (workflow: unknown) => workflow as { hooks: { validate(callback: typeof validate): unknown } }
  hookable(addToCartWorkflow).hooks.validate(validate)
  hookable(updateLineItemInCartWorkflow).hooks.validate(validate)
  hookable(updateCartWorkflow).hooks.validate(validate)
}

async function configuredEgyptEgpRegion(container: MedusaContainer): Promise<string> {
  const configured = process.env.ZAMZAM_EGP_REGION_ID
  if (!configured) throw new CartBffRuntimeError("CART_REGION_NOT_EGYPT_EGP")
  const result = await queryFor(container).graph({ entity: "region", fields: ["id", "currency_code", "countries.iso_2"], filters: { id: configured } })
  const region = result.data[0]
  if (!region || region.id !== configured || String(region.currency_code).toLowerCase() !== "egp" ||
      !(Array.isArray(region.countries) && (region.countries as Row[]).some((country) => String(country.iso_2).toLowerCase() === "eg"))) {
    throw new CartBffRuntimeError("CART_REGION_NOT_EGYPT_EGP")
  }
  return configured
}

async function configuredEgyptEgpSalesChannel(container: MedusaContainer): Promise<string | null> {
  const configured = process.env.ZAMZAM_SALES_CHANNEL_ID
  if (!configured) return null
  const result = await queryFor(container).graph({ entity: "sales_channel", fields: ["id"], filters: { id: configured } })
  if (result.data.length !== 1 || result.data[0].id !== configured) throw new CartBffRuntimeError("CART_UNAVAILABLE")
  return configured
}

function nativeDelivery(value: CartBffDelivery): Row {
  const governorate = resolveEgyptianGovernorateId(value.governorateId)
  if (!governorate) throw new CartBffRuntimeError("GUEST_DELIVERY_INVALID")
  return {
    first_name: value.firstName, last_name: value.lastName, phone: value.phone,
    address_1: value.address1, city: value.city, country_code: "eg", province: governorate.medusaProvinceCode,
    province_code: governorate.medusaProvinceCode,
    ...(value.address2 ? { address_2: value.address2 } : {}),
    ...(value.postalCode ? { postal_code: value.postalCode } : {}),
    ...(value.notes ? { metadata: { delivery_notes: value.notes } } : {}),
  }
}

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

export function createCartBffDependencies(container: MedusaContainer, response: HttpResponse): CartBffDependencies {
  installVersionHooks()
  const locking = container.resolve(Modules.LOCKING) as unknown as Locking
  const engine = container.resolve(Modules.WORKFLOW_ENGINE) as unknown as WorkflowEngine
  const ownership = createCartBffGuestOwnershipAdapter({
    container,
    resolveEgyptEgpRegion: () => configuredEgyptEgpRegion(container),
    resolveEgyptEgpSalesChannel: () => configuredEgyptEgpSalesChannel(container),
    readNativeCart: async (cartId, proof) => {
      if (!isVerifiedGuestCartOwnership(proof, cartId)) throw new CartBffRuntimeError("CART_UNAVAILABLE")
      return toSnapshot(container, await findNativeCart(container, cartId))
    },
  })

  return {
    async createOwnedEgpCart() { return ownership.createOwnedEgpCart() },
    async resolveOwnedCart(sessionSecret: string): Promise<GuestCartAuthority> { return ownership.resolveOwnedCart(sessionSecret) },
    async readNativeCart(cartId, proof) {
      if (!isVerifiedGuestCartOwnership(proof, cartId)) throw new CartBffRuntimeError("CART_UNAVAILABLE")
      return toSnapshot(container, await findNativeCart(container, cartId))
    },
    async mutateNativeCart(input) {
      if (!isVerifiedGuestCartOwnership(input.proof, input.cartId)) throw new CartBffRuntimeError("CART_UNAVAILABLE")
      const permit = signPermit({ v: 1, cartId: input.cartId, expectedVersion: input.expectedVersion,
        ownerKey: input.ownerKey, requestId: input.operation.requestId })
      if (!/^[a-f0-9]{64}$/.test(permit.ownerKey)) throw new CartBffRuntimeError("CART_UNAVAILABLE")
      const current = await findNativeCart(container, input.cartId)
      if (String(current.currency_code).toLowerCase() !== "egp") throw new CartBffRuntimeError("CART_REGION_NOT_EGYPT_EGP")
      const itemId = "lineItemId" in input.operation ? input.operation.lineItemId : null
      if (itemId && !(Array.isArray(current.items) && (current.items as Row[]).some((line) => line.id === itemId))) {
        throw new CartBffRuntimeError("CART_UNAVAILABLE")
      }
      const additional_data = { zamzam_cart_bff: permit }
      const run = async () => {
        const operation = input.operation
        if (operation.operation === "add_item") {
          await engine.run(addToCartWorkflowId, { input: { cart_id: input.cartId,
            items: [{ variant_id: operation.variantId, quantity: operation.quantity }], additional_data } })
        } else if (operation.operation === "update_item" || operation.operation === "remove_item") {
          await engine.run(updateLineItemInCartWorkflowId, { input: { cart_id: input.cartId, item_id: operation.lineItemId,
            update: { quantity: operation.operation === "remove_item" ? 0 : operation.quantity }, additional_data } })
        } else if (operation.operation === "set_delivery") {
          const address = nativeDelivery(operation.delivery)
          await engine.run(updateCartWorkflowId, { input: { id: input.cartId, email: operation.delivery.email,
            shipping_address: address, additional_data } })
        } else {
          throw new CartBffRuntimeError("UPSTREAM_UNAVAILABLE")
        }
      }
      try {
        await locking.execute("cart-bff:" + input.cartId, async () => {
          // Native workflows acquire their own `cart:<id>` Redis lock. The
          // signed validation hook compares the version only after that lock.
          await run()
        }, { timeout: 2, expire: 15 })
      } catch (error) {
        if (error instanceof CartBffRuntimeError) throw error
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : ""
        if (code) throw errorWithCode(code)
        throw new CartBffRuntimeError("UPSTREAM_UNAVAILABLE")
      }
      return toSnapshot(container, await findNativeCart(container, input.cartId))
    },
    async executeIdempotently<T>(
      { ownerKey, requestId, fingerprint }: { ownerKey: string; requestId: string; fingerprint: string },
      work: () => Promise<T>,
    ) {
      if (!/^[a-f0-9]{64}$/.test(ownerKey)) throw new CartBffRuntimeError("CART_UNAVAILABLE")
      const db = dbFor(container)
      const requestFingerprint = createHash("sha256").update(fingerprint).digest("hex")
      const inserted = await db.raw(`INSERT INTO cart_bff_idempotency(id,owner_key,request_id,fingerprint,status)
        VALUES(?,?,?,?,'in_progress') ON CONFLICT (owner_key,request_id) DO NOTHING RETURNING request_id`,
        ["cbi_" + randomUUID().replaceAll("-", ""), ownerKey, requestId, requestFingerprint])
      if (!inserted.rows.length) {
        const existing = (await db.raw("SELECT fingerprint,status,response FROM cart_bff_idempotency WHERE owner_key=? AND request_id=?", [ownerKey, requestId])).rows[0]
        if (!existing) throw new CartBffRuntimeError("CART_IDEMPOTENCY_UNAVAILABLE")
        if (existing.fingerprint !== requestFingerprint) throw new CartBffRuntimeError("CART_IDEMPOTENCY_CONFLICT")
        if (existing.status === "completed" && existing.response) {
          return (typeof existing.response === "string" ? JSON.parse(existing.response) : existing.response) as T
        }
        throw new CartBffRuntimeError("CART_IDEMPOTENCY_UNAVAILABLE")
      }
      try {
        const result = await work()
        await db.raw(`UPDATE cart_bff_idempotency SET status='completed',response=?,updated_at=now()
          WHERE owner_key=? AND request_id=? AND fingerprint=? AND status='in_progress'`,
          [JSON.stringify(result), ownerKey, requestId, requestFingerprint])
        return result
      } catch (error) {
        await db.raw(`UPDATE cart_bff_idempotency SET status='failed',updated_at=now()
          WHERE owner_key=? AND request_id=? AND fingerprint=? AND status='in_progress'`, [ownerKey, requestId, requestFingerprint])
        throw error
      }
    },
    issueGuestSessionCookie(sessionSecret) {
      response.cookie("zamzam_guest_cart", sessionSecret, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/store", maxAge: 24 * 60 * 60 * 1000,
      })
    },
    async readAvailability(lines) { return lines.map((line) => ({ variantId: line.variantId, status: "unknown" as const })) },
    async shippingReadiness(governorateId): Promise<readonly CartBffBlocker[]> {
      return getGovernorateShippingBlockers(governorateId) as CartBffBlocker[]
    },
    async paymentReadiness() { return false },
    async checkoutReadiness(snapshot, proof) {
      const native = asRow(snapshot.native)
      const address = asRow(native.shipping_address)
      const preflight = evaluateGuestCheckoutPreflight({
        cart: native as never,
        ownership: proof as never,
        guest: { email: native.email, first_name: address.first_name, last_name: address.last_name,
          phone: address.phone, address_1: address.address_1, address_2: address.address_2,
          city: address.city, province: address.province, postal_code: address.postal_code, country_code: address.country_code },
      })
      const known = new Set<CartBffBlocker>(["CART_UNAVAILABLE", "CART_REGION_UNAVAILABLE", "CART_REGION_NOT_EGYPT_EGP", "CART_CURRENCY_NOT_EGP",
        "CHECKOUT_OWNERSHIP_UNAVAILABLE", "GUEST_DELIVERY_INVALID", "MISSING_SHIPPING_ADDRESS", "MISSING_SHIPPING_METHOD",
        "SHIPPING_PRICE_UNAVAILABLE", "PAYABLE_TOTAL_UNAVAILABLE", "CHECKOUT_IN_PROGRESS", "CHECKOUT_ALREADY_COMPLETED", "CHECKOUT_SESSION_UNAVAILABLE"])
      const blockers = preflight.blockers.filter((blocker) => known.has(blocker as CartBffBlocker)) as CartBffBlocker[]
      return { status: "blocked" as const, blockers: [...new Set(blockers)] }
    },
  }
}

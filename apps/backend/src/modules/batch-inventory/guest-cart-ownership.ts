import { createHash, randomBytes } from "node:crypto"
import { createCartWorkflow } from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { CheckoutSessionStatus } from "./guest-checkout-preflight"

const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const verifiedOwnership = new WeakSet<object>()
type Row = Record<string, unknown>
type Sql = { raw(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number }> }
type RedisLocking = {
  defaultProviderId: string
  providerService_: { retrieveProviderRegistration(id: string): {
    keyNamePrefix: string
    redisClient: { get(key: string): Promise<string | null> }
  } }
}
type NativeCartService = { retrieveCart(id: string): Promise<{ id: string; customer_id?: string | null; completed_at?: Date | string | null }> }

export type GuestCartOwnershipResult =
  | { status: "owned"; cartId: string; sessionStatus: CheckoutSessionStatus }
  | { status: "not_owned"; blocker?: "CHECKOUT_ALREADY_COMPLETED" }
  | { status: "expired" | "unavailable" }

export class GuestCartOwnershipError extends Error {
  readonly code: "GUEST_CART_OWNERSHIP_UNAVAILABLE" | "GUEST_CART_NOT_ISSUABLE"
  constructor(code: "GUEST_CART_OWNERSHIP_UNAVAILABLE" | "GUEST_CART_NOT_ISSUABLE") {
    super(code)
    this.code = code
    this.name = "GuestCartOwnershipError"
  }
}

const digest = (token: string) => createHash("sha256").update(token, "utf8").digest("hex")
const validToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
const pg = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Sql

async function activeCartLock(container: MedusaContainer, cartId: string): Promise<boolean> {
  const locking = container.resolve(Modules.LOCKING) as unknown as RedisLocking
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  return (await provider.redisClient.get(provider.keyNamePrefix + "cart:" + cartId)) !== null
}

async function readCheckoutStatus(db: Sql, cartId: string): Promise<CheckoutSessionStatus> {
  const session = (await db.raw(`SELECT status FROM cart_checkout_session
    WHERE cart_id=? AND deleted_at IS NULL`, [cartId])).rows[0]
  if (!session) return "missing"
  if (["in_progress", "completed", "aborted", "failed"].includes(String(session.status))) {
    return String(session.status) as CheckoutSessionStatus
  }
  return "unavailable"
}

/**
 * Server-only issuance hook. Call only with an id returned by native Medusa cart
 * creation in the same trusted server flow; never forward a browser cart id.
 * The raw secret is returned only to that server flow for HttpOnly cookie setup.
 */
async function issueForServerCreatedCart(container: MedusaContainer, serverCreatedCartId: string): Promise<{
  sessionSecret: string
  expiresAt: string
}> {
  try {
    if (!serverCreatedCartId || typeof serverCreatedCartId !== "string") throw new GuestCartOwnershipError("GUEST_CART_NOT_ISSUABLE")
    const cart = await (container.resolve(Modules.CART) as unknown as NativeCartService).retrieveCart(serverCreatedCartId)
    if (cart.id !== serverCreatedCartId || cart.customer_id || cart.completed_at) throw new GuestCartOwnershipError("GUEST_CART_NOT_ISSUABLE")
    const db = pg(container)
    const status = await readCheckoutStatus(db, serverCreatedCartId)
    if (status === "in_progress" || status === "completed" || status === "unavailable" ||
        await activeCartLock(container, serverCreatedCartId)) {
      throw new GuestCartOwnershipError("GUEST_CART_NOT_ISSUABLE")
    }
    const sessionSecret = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await db.raw(`INSERT INTO guest_cart_ownership(session_hash,cart_id,expires_at)
      VALUES(?,?,?)`, [digest(sessionSecret), serverCreatedCartId, expiresAt.toISOString()])
    return { sessionSecret, expiresAt: expiresAt.toISOString() }
  } catch (error) {
    if (error instanceof GuestCartOwnershipError) throw error
    throw new GuestCartOwnershipError("GUEST_CART_OWNERSHIP_UNAVAILABLE")
  }
}

/** Create a native guest cart and its ownership secret without accepting a cart ID. */
export async function createGuestCartWithOwnership(container: MedusaContainer, input: {
  regionId: string
  salesChannelId?: string
}): Promise<{ cartId: string; sessionSecret: string; expiresAt: string }> {
  if (!input || typeof input.regionId !== "string" || !input.regionId ||
      (input.salesChannelId !== undefined && typeof input.salesChannelId !== "string")) {
    throw new GuestCartOwnershipError("GUEST_CART_NOT_ISSUABLE")
  }
  try {
    const { result: cart } = await createCartWorkflow(container).run({ input: {
      region_id: input.regionId,
      ...(input.salesChannelId ? { sales_channel_id: input.salesChannelId } : {}),
    } })
    const issued = await issueForServerCreatedCart(container, cart.id)
    return { cartId: cart.id, ...issued }
  } catch (error) {
    if (error instanceof GuestCartOwnershipError) throw error
    throw new GuestCartOwnershipError("GUEST_CART_OWNERSHIP_UNAVAILABLE")
  }
}

/** Resolve identity from the opaque session secret; cart id is only an optional equality check. */
export async function resolveGuestCartOwnership(
  container: MedusaContainer,
  sessionSecret: unknown,
  expectedCartId?: unknown,
): Promise<GuestCartOwnershipResult> {
  if (!validToken(sessionSecret)) return { status: "not_owned" }
  try {
    const db = pg(container)
    const row = (await db.raw(`SELECT cart_id,expires_at,invalidated_at FROM guest_cart_ownership
      WHERE session_hash=?`, [digest(sessionSecret)])).rows[0]
    if (!row) return { status: "not_owned" }
    if (row.invalidated_at) return { status: "not_owned" }
    const cartId = String(row.cart_id ?? "")
    if (!cartId || (expectedCartId !== undefined && expectedCartId !== cartId)) return { status: "not_owned" }
    const expiration = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at))
    if (!Number.isFinite(expiration)) return { status: "unavailable" }
    if (expiration <= Date.now()) return { status: "expired" }

    const cart = await (container.resolve(Modules.CART) as unknown as NativeCartService).retrieveCart(cartId)
    if (cart.id !== cartId) return { status: "not_owned" }
    const sessionStatus = await readCheckoutStatus(db, cartId)
    if (cart.completed_at || sessionStatus === "completed") {
      await db.raw(`UPDATE guest_cart_ownership SET invalidated_at=NOW(),updated_at=NOW()
        WHERE session_hash=? AND invalidated_at IS NULL`, [digest(sessionSecret)])
      return { status: "not_owned", blocker: "CHECKOUT_ALREADY_COMPLETED" }
    }
    if (await activeCartLock(container, cartId)) return { status: "unavailable" }
    if (sessionStatus === "unavailable") return { status: "unavailable" }
    const result: GuestCartOwnershipResult = { status: "owned", cartId, sessionStatus }
    verifiedOwnership.add(result)
    return result
  } catch {
    // Database, Medusa cart service, and Redis failures never grant ownership.
    return { status: "unavailable" }
  }
}

/** Invalidation requires the secret; only trusted server flows should call this. */
export async function invalidateGuestCartOwnership(container: MedusaContainer, sessionSecret: unknown): Promise<boolean> {
  if (!validToken(sessionSecret)) return false
  try {
    const result = await pg(container).raw(`UPDATE guest_cart_ownership SET invalidated_at=NOW(),updated_at=NOW()
      WHERE session_hash=? AND invalidated_at IS NULL RETURNING session_hash`, [digest(sessionSecret)])
    return result.rows.length === 1
  } catch {
    return false
  }
}

/** Preflight accepts only the exact in-memory object minted by this resolver. */
export function isVerifiedGuestCartOwnership(value: unknown, cartId: unknown): value is Extract<GuestCartOwnershipResult, { status: "owned" }> {
  return Boolean(value && typeof value === "object" && verifiedOwnership.has(value) &&
    (value as { status?: unknown }).status === "owned" && (value as { cartId?: unknown }).cartId === cartId)
}

/** Preflight accepts only the exact in-memory object minted by this resolver. */

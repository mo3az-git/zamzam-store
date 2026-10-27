import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { normalizeEgpTotal } from "./native-payable-order-snapshot"
import { completeReservedCartWithInventory, type NativeCheckoutFaultHooks } from "./native-checkout-coordinator"
import type { InventoryAuthority } from "./ledger"

type Row = Record<string, unknown>
type Sql = { raw(sql: string, values?: unknown[]): Promise<{ rows: Row[] }> }
type Locking = { defaultProviderId: string; providerService_: { retrieveProviderRegistration(id: string): {
  keyNamePrefix: string; redisClient: { get(key: string): Promise<string | null> }
} } }

/** Trusted server-side caller: the caller must maintain the normal cart mutation guard. */
export async function assertPayableCheckoutReady(container: MedusaContainer, authority: InventoryAuthority) {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Sql
  const locking = container.resolve(Modules.LOCKING) as unknown as Locking
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  if (await provider.redisClient.get(provider.keyNamePrefix + "cart:" + authority.cartId) !== authority.ownerId)
    throw new Error("PAYABLE_CART_LOCK_NOT_OWNED")
  const state = (await db.raw(`SELECT a.epoch,a.cart_id,a.lease_owner_id,a.checkout_attempt_id::text AS id,
    s.current_attempt_id::text AS current_attempt_id,s.epoch AS session_epoch,s.status AS session_status
    FROM cart_checkout_attempt a JOIN cart_checkout_session s ON s.cart_id=a.cart_id AND s.deleted_at IS NULL
    JOIN idempotency_key k ON k.key=a.idempotency_key AND k.deleted_at IS NULL
    WHERE a.checkout_attempt_id=?::uuid AND a.cart_id=? AND k.status='pending'
      AND k.lease_owner_id=a.lease_owner_id AND k.last_heartbeat_at>NOW()-INTERVAL '120 seconds'`,
  [authority.attemptId, authority.cartId])).rows[0]
  if (!state || state.id !== authority.attemptId || state.current_attempt_id !== authority.attemptId ||
      Number(state.epoch) !== authority.epoch || Number(state.session_epoch) !== authority.epoch ||
      state.lease_owner_id !== authority.ownerId || state.session_status !== "in_progress")
    throw new Error("PAYABLE_STALE_CHECKOUT_AUTHORITY")
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as { graph(input: Row): Promise<{ data: Row[] }> }
  const cart = (await query.graph({ entity: "cart", fields: ["id", "currency_code", "total", "raw_total",
    "payment_collection.id", "payment_collection.currency_code", "payment_collection.amount", "payment_collection.raw_amount",
    "payment_collection.payment_sessions.id", "payment_collection.payment_sessions.status",
    "payment_collection.payment_sessions.currency_code", "payment_collection.payment_sessions.amount",
    "payment_collection.payment_sessions.raw_amount"], filters: { id: authority.cartId } })).data[0]
  const collection = cart?.payment_collection as Row | undefined
  const sessions = collection?.payment_sessions as Row[] | undefined
  if (!cart || cart.id !== authority.cartId || String(cart.currency_code).toLowerCase() !== "egp" ||
      !collection || String(collection.currency_code).toLowerCase() !== "egp" || !sessions || sessions.length !== 1)
    throw new Error("PAYABLE_PAYMENT_PREREQUISITES_INVALID")
  const session = sessions[0]
  if (!["pending", "requires_more", "authorized", "captured", "pending_authorization"].includes(String(session.status)) ||
      String(session.currency_code).toLowerCase() !== "egp") throw new Error("PAYABLE_PAYMENT_SESSION_INVALID")
  const cartTotal = normalizeEgpTotal(cart.raw_total)
  const collectionTotal = normalizeEgpTotal(collection.raw_amount)
  const sessionTotal = normalizeEgpTotal(session.raw_amount)
  if (cartTotal.minor !== collectionTotal.minor || cartTotal.minor !== sessionTotal.minor)
    throw new Error("PAYABLE_PAYMENT_AMOUNT_MISMATCH")
  return { cartId: authority.cartId, currency: "egp", totalMajor: cartTotal.major, totalMinor: cartTotal.minor }
}

/** Checks once before the fence and again immediately before invoking Medusa. */
export async function completePayableReservedCart(container: MedusaContainer, authority: InventoryAuthority,
  hooks: NativeCheckoutFaultHooks = {}) {
  const expected = await assertPayableCheckoutReady(container, authority)
  const checkout = await completeReservedCartWithInventory(container, authority, {
    ...hooks,
    async beforeNativeCompletion() {
      const current = await assertPayableCheckoutReady(container, authority)
      if (current.totalMinor !== expected.totalMinor) throw new Error("PAYABLE_PAYMENT_AMOUNT_CHANGED")
      await hooks.beforeNativeCompletion?.()
    },
  })
  return { checkout, expected }
}

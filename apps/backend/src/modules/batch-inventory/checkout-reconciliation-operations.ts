import { createHash } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { completeReservedCartWithInventory } from "./native-checkout-coordinator"
import { findNativeOrdersByCart } from "./native-order-lookup"
import type { InventoryAuthority, LedgerHooks } from "./ledger"

type Row = Record<string, unknown>
type Sql = { raw(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number }> }
type Locking = { defaultProviderId: string; providerService_: { retrieveProviderRegistration(id: string): {
  keyNamePrefix: string; redisClient: { get(key: string): Promise<string | null> }
} } }
type Identity = { cartId: string; attemptId: string }
type Authorize = (action: "inspect" | "recover", identity: Identity) => boolean | Promise<boolean>
const rows = async (db: Sql, query: string, values: unknown[]) => (await db.raw(query, values)).rows
const fingerprint = (value: unknown) => typeof value === "string" && value
  ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null
const sameIds = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
const safeResponse = (value: unknown) => {
  if (!value || typeof value !== "object") return null
  const r = value as Row
  if (typeof r.orderId !== "string" || r.conversionStatus !== "allocated" ||
      !Number.isSafeInteger(r.orderVersion) || !Array.isArray(r.allocationIds) ||
      !Array.isArray(r.movementIds) || !r.allocationIds.every((x) => typeof x === "string") ||
      !r.movementIds.every((x) => typeof x === "string")) return null
  return { orderId: r.orderId, conversionStatus: "allocated", orderVersion: r.orderVersion,
    allocationIds: r.allocationIds as string[], movementIds: r.movementIds as string[] }
}

/**
 * Internal composition root must supply a real operator authorizer. No route is
 * registered here. Never pass client-supplied owner tokens as trusted authority.
 * Inspection is advisory: recover always rechecks under canonical locks.
 */
export class CheckoutReconciliationOperations {
  constructor(private readonly container: MedusaContainer, private readonly authorize: Authorize,
    private readonly onLockEvent?: LedgerHooks["event"]) {
    if (typeof authorize !== "function") throw new Error("OPERATOR_AUTHORIZER_REQUIRED")
  }

  private async authorized(action: "inspect" | "recover", identity: Identity) {
    if (!identity.cartId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.attemptId)) {
      throw new Error("INVALID_RECONCILIATION_IDENTITY")
    }
    if (await this.authorize(action, identity) !== true) throw new Error("OPERATOR_NOT_AUTHORIZED")
  }

  async inspect(identity: Identity) {
    await this.authorized("inspect", identity)
    try { return await this.inspectAuthorized(identity) }
    catch { return { decision: "blocked" as const, reason: "INSPECTION_UNAVAILABLE", identity } }
  }

  private async inspectAuthorized(identity: Identity) {
    const db = this.container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Sql
    const record = (await rows(db, `SELECT a.checkout_attempt_id::text AS attempt_id,a.cart_id,a.epoch,
      a.lease_owner_id,a.idempotency_key,a.attempt_status,a.order_id,a.order_correlation_status,
      s.current_attempt_id::text AS current_attempt_id,s.epoch AS session_epoch,s.status AS session_status,
      k.status AS key_status,k.lease_owner_id AS key_owner,k.response_body,k.order_id AS response_order_id,
      k.last_heartbeat_at + INTERVAL '120 seconds' AS lease_expires_at,
      k.last_heartbeat_at > NOW()-INTERVAL '120 seconds' AS lease_fresh
      FROM cart_checkout_attempt a LEFT JOIN cart_checkout_session s ON s.cart_id=a.cart_id AND s.deleted_at IS NULL
      LEFT JOIN idempotency_key k ON k.key=a.idempotency_key AND k.deleted_at IS NULL
      WHERE a.checkout_attempt_id=?::uuid AND a.cart_id=?`, [identity.attemptId, identity.cartId]))[0]
    if (!record) return { decision: "blocked" as const, reason: "ATTEMPT_NOT_FOUND", identity }
    const reservations = await rows(db, `SELECT id,cart_id,checkout_epoch,checkout_line_key,batch_id,variant_id,quantity,status,
      expires_at,expires_at>NOW() AS unexpired FROM cart_batch_reservation
      WHERE checkout_attempt_id=? ORDER BY id`, [identity.attemptId])
    const candidates = await findNativeOrdersByCart(db, identity.cartId)
    const orderIds = [...new Set(candidates.map((entry) => entry.id))]
    const associatedOrderIds = [...new Set([...orderIds, ...(typeof record.order_id === "string" ? [record.order_id] : [])])]
    const allocations = associatedOrderIds.length ? await rows(db, `SELECT id,order_id,order_version,checkout_line_key,
      batch_id,quantity_allocated,allocation_status FROM order_batch_allocation WHERE order_id=ANY(?::text[]) ORDER BY id`, [associatedOrderIds]) : []
    const reservationIds = reservations.map((r) => String(r.id))
    const batchIds = [...new Set(reservations.map((r) => String(r.batch_id)))]
    const batches = batchIds.length ? await rows(db, `SELECT b.id,b.quantity_on_hand,b.quantity_reserved,b.quantity_quarantined,
      (b.quantity_on_hand=COALESCE(SUM(m.quantity_on_hand_delta),0) AND
       b.quantity_reserved=COALESCE(SUM(m.quantity_reserved_delta),0) AND
       b.quantity_quarantined=COALESCE(SUM(m.quantity_quarantined_delta),0)) AS ledger_balanced
      FROM inventory_batch b LEFT JOIN inventory_movement m ON m.batch_id=b.id
      WHERE b.id=ANY(?::text[]) GROUP BY b.id ORDER BY b.id`, [batchIds]) : []
    const movements = await rows(db, `SELECT id,movement_type,reference_type,reference_id,batch_id
      FROM inventory_movement WHERE (reference_type='order_allocation' AND reference_id=ANY(?::text[]))
      OR (reference_type IN ('cart_reservation','cleanup') AND reference_id=ANY(?::text[])) ORDER BY id`, [associatedOrderIds,reservationIds])
    const locking = this.container.resolve(Modules.LOCKING) as unknown as Locking
    const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
    const redisOwner = await provider.redisClient.get(provider.keyNamePrefix + "cart:" + identity.cartId)
    const cartLockOwned = typeof record.lease_owner_id === "string" && redisOwner === record.lease_owner_id
    const leaseOwnerMatches = record.lease_owner_id === record.key_owner && typeof record.key_owner === "string"
    const response = safeResponse(record.response_body)
    let lineInvariant: string | null = null
    let nativeOrderVersion: number | null = null
    if (orderIds.length === 1) {
      try {
        const orders = this.container.resolve(Modules.ORDER) as unknown as { retrieveOrder(id: string, options: Row): Promise<Row> }
        const order = await orders.retrieveOrder(orderIds[0], { relations: ["items", "items.detail"] })
        nativeOrderVersion = Number(order.version)
        const mapped = new Map<string, { variant: unknown; quantity: number }>()
        if (!Array.isArray(order.items) || !Number.isSafeInteger(nativeOrderVersion) || nativeOrderVersion < 1) lineInvariant = "NATIVE_ORDER_SNAPSHOT_INVALID"
        else for (const item of order.items as Row[]) {
          const metadata = item.metadata as Row | null
          const lineMetadata = item.line_item_metadata as Row | null
          const a = metadata?.checkout_line_key, b = lineMetadata?.checkout_line_key
          const key = a ?? b
          const detail = item.detail as Row | null
          if (a !== undefined && b !== undefined && a !== b) { lineInvariant = "AMBIGUOUS_LINE_MAPPING"; break }
          if (key === undefined || key === null || key === "") { lineInvariant = "UNMAPPED_OR_AMBIGUOUS_LINE_ITEM"; break }
          if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) || mapped.has(key)) { lineInvariant = "AMBIGUOUS_LINE_MAPPING"; break }
          mapped.set(key, { variant: item.variant_id, quantity: Number(detail?.quantity ?? item.quantity) })
        }
        if (!lineInvariant) {
          const totals = new Map<string, number>()
          for (const r of reservations) {
            const line = mapped.get(String(r.checkout_line_key))
            if (!line) { lineInvariant = "UNMAPPED_OR_AMBIGUOUS_LINE_ITEM"; break }
            if (line.variant !== r.variant_id) { lineInvariant = "ORDER_LINE_VARIANT_MISMATCH"; break }
            totals.set(String(r.checkout_line_key), (totals.get(String(r.checkout_line_key)) || 0) + Number(r.quantity))
          }
          if (!lineInvariant && (totals.size !== mapped.size ||
              [...totals].some(([key, quantity]) => mapped.get(key)?.quantity !== quantity))) {
            lineInvariant = "ORDER_LINE_QUANTITY_MISMATCH"
          }
        }
      } catch { lineInvariant = "NATIVE_ORDER_INSPECTION_FAILED" }
    }
    const completed = record.attempt_status === "allocated" && record.session_status === "completed"
    const fence = ["order_creation_started", "needs_reconciliation", "order_created", "allocated"].includes(String(record.attempt_status))
    let decision: "ready" | "blocked" | "ambiguous" | "unresolved" | "completed" = "ready"
    let reason = "ONE_NATIVE_ORDER_RECOVERABLE"
    const block = (code: string) => { decision = "blocked"; reason = code }
    if (record.current_attempt_id !== identity.attemptId || Number(record.session_epoch) !== Number(record.epoch) ||
        !["in_progress", "completed"].includes(String(record.session_status))) block("STALE_CHECKOUT_AUTHORITY")
    else if (!fence) block("RECONCILIATION_FENCE_REQUIRED")
    else if ((["order_creation_started", "needs_reconciliation"].includes(String(record.attempt_status)) &&
              (!["pending_correlation", "needs_reconciliation"].includes(String(record.order_correlation_status)) || record.order_id)) ||
             (["order_created", "allocated"].includes(String(record.attempt_status)) &&
              (record.order_correlation_status !== "correlated" || !record.order_id))) block("CORRELATION_STATE_DIVERGENCE")
    else if (!leaseOwnerMatches) block("LEASE_OWNER_MISMATCH")
    else if (!cartLockOwned) block("CART_LOCK_NOT_OWNED")
    else if (!(record.key_status === "pending" && record.lease_fresh === true) &&
             !(completed && record.key_status === "completed")) block("LEASE_EXPIRED_OR_INVALID")
    else if (!reservations.length) block("RESERVATIONS_MISSING")
    else if (reservations.some((r) => r.cart_id !== identity.cartId || Number(r.checkout_epoch) !== Number(record.epoch))) block("RESERVATION_AUTHORITY_DIVERGENCE")
    else if (batches.length !== batchIds.length || batches.some((b) => b.ledger_balanced !== true)) block("INVENTORY_LEDGER_DIVERGENCE")
    else if (reservations.some((r) => completed ? r.status !== "converted" : r.status !== "active")) block("RESERVATION_STATE_DIVERGENCE")
    else if (!completed && reservations.some((r) => r.unexpired !== true)) block("RESERVATION_EXPIRED")
    else if (movements.some((m) => m.movement_type === "reservation_release")) block("RESERVATION_RELEASE_DIVERGENCE")
    else if (orderIds.length > 1) { decision = "ambiguous"; reason = "MULTIPLE_NATIVE_ORDERS" }
    else if (orderIds.length === 0) {
      if (record.order_id) block("BOUND_ORDER_LINK_DIVERGENCE")
      else { decision = "unresolved"; reason = "NO_NATIVE_ORDER_AFTER_FENCE" }
    } else if (record.order_id && record.order_id !== orderIds[0]) block("BOUND_ORDER_LINK_DIVERGENCE")
    else if (lineInvariant) block(lineInvariant)
    else if (!completed && (allocations.length || movements.some((m) => m.movement_type === "allocation_conversion"))) block("UNEXPECTED_ALLOCATION_STATE")
    else if (completed) {
      const conversions = movements.filter((m) => m.movement_type === "allocation_conversion")
      const match = allocations.length === reservations.length && conversions.length === reservations.length &&
        reservations.every((r) => allocations.some((a) => a.checkout_line_key === r.checkout_line_key &&
          a.batch_id === r.batch_id && Number(a.quantity_allocated) === Number(r.quantity) && a.allocation_status === "allocated" &&
          Number(a.order_version) === nativeOrderVersion))
      if (!match) block("ALLOCATION_SET_DIVERGENCE")
      else if (record.key_status === "completed" && (!response || record.response_order_id !== orderIds[0] ||
        response.orderId !== orderIds[0] || response.orderVersion !== nativeOrderVersion ||
        !sameIds(response.allocationIds, allocations.map((a) => String(a.id))) ||
        !sameIds(response.movementIds, conversions.map((m) => String(m.id))))) block("COMPLETION_RESPONSE_DIVERGENCE")
      else if (record.key_status === "completed") { decision = "completed"; reason = "EXACT_REPLAY_AVAILABLE" }
      else reason = "ALLOCATION_COMMITTED_RESPONSE_PENDING"
    }
    return { decision, reason, identity, epoch: Number(record.epoch), sessionStatus: record.session_status,
      attemptStatus: record.attempt_status, correlationStatus: record.order_correlation_status,
      boundOrderId: record.order_id, lease: { ownerFingerprint: fingerprint(record.lease_owner_id),
        ownerMatches: leaseOwnerMatches, cartLockOwned, fresh: record.lease_fresh === true, expiresAt: record.lease_expires_at },
      idempotency: { key: record.idempotency_key, status: record.key_status, response },
      candidates, reservations, allocations, movements, batches }
  }

  async recover(authority: InventoryAuthority) {
    const identity = { cartId: authority.cartId, attemptId: authority.attemptId }
    await this.authorized("recover", identity)
    let inspection
    try { inspection = await this.inspectAuthorized(identity) }
    catch { return { decision: "blocked" as const, reason: "INSPECTION_UNAVAILABLE" } }
    if (inspection.decision !== "ready" && inspection.decision !== "completed") {
      return { decision: inspection.decision, reason: inspection.reason }
    }
    if (inspection.epoch !== authority.epoch || inspection.lease?.ownerFingerprint !== fingerprint(authority.ownerId)) {
      return { decision: "blocked" as const, reason: "STALE_CHECKOUT_AUTHORITY" }
    }
    try {
      // This flag is enforced inside the durable fence transaction itself.
      const result = await completeReservedCartWithInventory(this.container, authority,
        { reconciliationOnly: true, event: this.onLockEvent })
      if (result.conversionStatus !== "allocated") {
        let latest
        try { latest = await this.inspectAuthorized(identity) }
        catch { return { decision: "blocked" as const, reason: "INSPECTION_UNAVAILABLE" } }
        if (["blocked", "ambiguous", "unresolved"].includes(latest.decision)) {
          return { decision: latest.decision, reason: latest.reason }
        }
        return { decision: "unresolved" as const, reason: "RECONCILIATION_STATE_CHANGED_RETRY" }
      }
      return { decision: result.replayed ? "completed" as const : "recovered" as const,
        reason: result.replayed ? "EXACT_REPLAY" : "ORDER_RECOVERED", result }
    } catch (error) {
      const code = error instanceof Error ? ("code" in error ? String(error.code) : error.message) : ""
      const known = new Set(["CART_LOCK_OWNER_MISMATCH", "CHECKOUT_LEASE_NOT_OWNED", "STALE_OR_UNAUTHORIZED_ATTEMPT",
        "ORDER_ROOT_CHANGED_DURING_RECONCILIATION", "BOUND_ORDER_LOOKUP_DIVERGENCE", "RECONCILIATION_FENCE_REQUIRED",
        "RESERVATION_AUTHORITY_MISMATCH", "RESERVATION_EXPIRED", "INCOMPLETE_VALIDATED_RESERVATION_SET",
        "UNMAPPED_OR_AMBIGUOUS_LINE_ITEM", "AMBIGUOUS_LINE_MAPPING", "ORDER_LINE_VARIANT_MISMATCH",
        "ORDER_LINE_QUANTITY_MISMATCH", "INVENTORY_LEDGER_DIVERGENCE", "CHECKOUT_RESPONSE_DIVERGENCE"])
      return { decision: "blocked" as const, reason: known.has(code) ? code : "RECOVERY_FAILED" }
    }
  }
}

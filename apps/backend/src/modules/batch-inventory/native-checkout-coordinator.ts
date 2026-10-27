import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { InventoryLedger, type InventoryAuthority, type LedgerHooks } from "./ledger"
import { completeNativeCartWithFence, type NativeCompletionHooks } from "./native-order-bridge"

type Row = Record<string, unknown>
type Sql = {
  raw(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number }>
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>
}
type Locking = {
  defaultProviderId: string
  providerService_: { retrieveProviderRegistration(id: string): {
    keyNamePrefix: string
    redisClient: { get(key: string): Promise<string | null> }
  } }
}
const conflict = (code: string) => new MedusaError(MedusaError.Types.CONFLICT, code, code)
const rows = async (tx: Sql, sql: string, values: unknown[] = []) => (await tx.raw(sql, values)).rows
export type NativeCheckoutFaultHooks = NativeCompletionHooks & Pick<LedgerHooks, "event" | "afterConversionAllocation">

/**
 * Trusted server-side coordinator for a reserved Medusa cart. This module is
 * intentionally not wired to a Store API route: callers must derive authority
 * from persisted checkout state and pass only disposable or otherwise approved
 * native carts through the established checkout boundary.
 */
export async function completeReservedCartWithInventory(
  container: MedusaContainer,
  authority: InventoryAuthority,
  faultHooks: NativeCheckoutFaultHooks = {}
) {
  if (!authority.cartId || !authority.attemptId || !authority.ownerId ||
      !Number.isSafeInteger(authority.epoch) || authority.epoch < 1) {
    throw conflict("INVALID_CHECKOUT_AUTHORITY")
  }

  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Sql
  const locking = container.resolve(Modules.LOCKING) as unknown as Locking
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  const redisOwner = await provider.redisClient.get(provider.keyNamePrefix + "cart:" + authority.cartId)
  if (redisOwner !== authority.ownerId) throw conflict("CART_LOCK_OWNER_MISMATCH")

  // Revision 18 order-rooted authority: observe an existing order without a
  // row lock, take its advisory root, then lock session/attempt in that order.
  const observed = (await rows(db, "SELECT order_id FROM cart_checkout_attempt WHERE checkout_attempt_id=?::uuid", [authority.attemptId]))[0]
  const inspected = await db.transaction(async (tx) => {
    if (observed?.order_id) {
      await tx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", ["phase0:order:" + observed.order_id])
    }
    const session = (await rows(tx, `SELECT cart_id,current_attempt_id,epoch,status FROM cart_checkout_session
      WHERE cart_id=? AND deleted_at IS NULL FOR UPDATE`, [authority.cartId]))[0]
    const attempt = (await rows(tx, `SELECT checkout_attempt_id::text AS id,cart_id,epoch,idempotency_key,
      lease_owner_id,attempt_status,order_id,order_correlation_status FROM cart_checkout_attempt
      WHERE checkout_attempt_id=?::uuid FOR UPDATE`, [authority.attemptId]))[0]
    const allocatedReplay = session?.status === "completed" && attempt?.attempt_status === "allocated" &&
      Boolean(attempt?.order_id) && attempt?.order_correlation_status === "correlated"
    if (!session || !attempt || session.current_attempt_id !== authority.attemptId ||
        Number(session.epoch) !== authority.epoch || (session.status !== "in_progress" && !allocatedReplay) ||
        attempt.cart_id !== authority.cartId || Number(attempt.epoch) !== authority.epoch ||
        attempt.lease_owner_id !== authority.ownerId || attempt.order_id !== (observed?.order_id ?? null)) {
      throw conflict("STALE_OR_UNAUTHORIZED_ATTEMPT")
    }
    const lease = (await rows(tx, `SELECT key,status FROM idempotency_key WHERE key=? AND lease_owner_id=?
      AND status IN ('pending','completed') AND deleted_at IS NULL
      AND (status='completed' OR last_heartbeat_at>NOW()-INTERVAL '120 seconds')`,
      [attempt.idempotency_key, authority.ownerId]))[0]
    if (!lease || (lease.status === "completed" && !["allocated"].includes(String(attempt.attempt_status)))) {
      throw conflict("CHECKOUT_LEASE_NOT_OWNED")
    }

    const reservations = await rows(tx, `SELECT id,checkout_attempt_id,cart_id,checkout_epoch,status
      FROM cart_batch_reservation WHERE checkout_attempt_id=? ORDER BY id`, [authority.attemptId])
    const phase = String(attempt.attempt_status)
    if (!["initiated", "reserved", "order_creation_started", "needs_reconciliation", "order_created", "allocated"].includes(phase)) {
      throw conflict("INVALID_CHECKOUT_ATTEMPT_PHASE")
    }
    if (["order_creation_started", "needs_reconciliation"].includes(phase) && !reservations.length) {
      throw conflict("RESERVATIONS_REQUIRED_FOR_RECONCILIATION")
    }
    if (reservations.some((r) => r.cart_id !== authority.cartId ||
        Number(r.checkout_epoch) !== authority.epoch || r.checkout_attempt_id !== authority.attemptId ||
        !["active", "converted"].includes(String(r.status)))) {
      throw conflict("RESERVATION_AUTHORITY_MISMATCH")
    }
    return { phase, reservationIds: reservations.map((r) => String(r.id)) }
  })

  const ledger = new InventoryLedger(container, faultHooks)
  let reservationIds = inspected.reservationIds
  if (["initiated", "reserved"].includes(inspected.phase)) {
    // reserveCart is read-only for the exact persisted reservation set and is
    // the existing validator for native cart-line identity, Redis ownership,
    // lease freshness, line keys and FEFO reservation state.
    const reservations = await ledger.reserveCart(authority)
    reservationIds = reservations.map((entry) => String(entry.reservation.id))
  }
  if (!reservationIds.length) throw conflict("RESERVATIONS_REQUIRED_FOR_NATIVE_CHECKOUT")

  const correlation = await completeNativeCartWithFence(container, db, authority, faultHooks)
  if (correlation.status !== "correlated" || !correlation.orderId) {
    return {
      orderId: null,
      conversionStatus: "pending_reconciliation" as const,
      replayed: Boolean(correlation.replay),
    }
  }

  const conversion = await ledger.convertCartReservationsToAllocations({
    ...authority,
    orderId: correlation.orderId,
    validatedReservationIds: reservationIds,
  })
  const result = {
    orderId: correlation.orderId,
    conversionStatus: "allocated" as const,
    orderVersion: conversion.orderVersion,
    allocationIds: conversion.allocations.map((row) => String(row.id)),
    movementIds: conversion.movements.map((row) => String(row.id)),
    replayed: Boolean(correlation.replay && conversion.replay),
  }
  const attempt = (await rows(db, `SELECT idempotency_key FROM cart_checkout_attempt
    WHERE checkout_attempt_id=?::uuid AND cart_id=?`, [authority.attemptId, authority.cartId]))[0]
  if (!attempt) throw conflict("CHECKOUT_ATTEMPT_DISAPPEARED")
  const priorResponse = (await rows(db, `SELECT status,order_id,response_body FROM idempotency_key
    WHERE key=? AND lease_owner_id=? AND deleted_at IS NULL`, [attempt.idempotency_key, authority.ownerId]))[0]
  if (priorResponse?.status === "completed") {
    const body = priorResponse.response_body as Row | null
    const sameIds = (key: string, expected: string[]) => Array.isArray(body?.[key]) &&
      [...(body[key] as string[])].sort().join("\n") === [...expected].sort().join("\n")
    if (priorResponse.order_id !== result.orderId || body?.orderId !== result.orderId ||
        body?.conversionStatus !== "allocated" || Number(body?.orderVersion) !== result.orderVersion ||
        !sameIds("allocationIds", result.allocationIds) || !sameIds("movementIds", result.movementIds)) {
      throw conflict("CHECKOUT_RESPONSE_DIVERGENCE")
    }
    return { ...result, replayed: true }
  }
  const persisted = await db.raw(`UPDATE idempotency_key SET status='completed',order_id=?,response_code=200,
    response_body=?::jsonb,updated_at=NOW() WHERE key=? AND lease_owner_id=? AND status IN ('pending','completed')
    AND deleted_at IS NULL RETURNING key`, [correlation.orderId, JSON.stringify({
      orderId: result.orderId,
      conversionStatus: result.conversionStatus,
      orderVersion: result.orderVersion,
      allocationIds: result.allocationIds,
      movementIds: result.movementIds,
      replayed: false,
    }), attempt.idempotency_key, authority.ownerId])
  if (persisted.rowCount !== 1) throw conflict("CHECKOUT_RESPONSE_PERSISTENCE_FAILED")
  return result
}

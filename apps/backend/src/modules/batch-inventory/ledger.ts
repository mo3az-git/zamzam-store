import { createHash, randomUUID } from "node:crypto"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

type Row = Record<string, unknown>
interface Sql {
  raw(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number }>
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>
}
interface Batch extends Row {
  id: string; variant_id: string; expiration_date: string; unit_cost_final: string
  quantity_on_hand: number; quantity_reserved: number; quantity_quarantined: number
}
interface Reservation extends Row {
  id: string; checkout_attempt_id: string; cart_id: string; checkout_line_key: string
  checkout_epoch: number; cart_line_item_id: string; variant_id: string; batch_id: string
  quantity: number; unit_cost_snapshot: string; status: string; expires_at: Date; unexpired?: boolean
}
interface Movement extends Row {
  id: string; batch_id: string; variant_id: string; movement_type: string
  reference_type: string; reference_id: string; reason: string | null; actor_id: string
  quantity_on_hand_delta: number; quantity_reserved_delta: number; quantity_quarantined_delta: number
}
interface InspectedLockingModule {
  defaultProviderId: string
  providerService_: { retrieveProviderRegistration(id: string): {
    keyNamePrefix: string; redisClient: { get(key: string): Promise<string | null> }
  } }
}
export interface InventoryAuthority {
  cartId: string; attemptId: string; epoch: number; ownerId: string
}
export interface IntakeInput {
  receiptOperationId: string; variantId: string; locationId: string; supplierId: string
  batchNumber: string; invoiceReference: string; productionDate?: string | null; expirationDate: string
  purchaseCurrency: string; purchasePrice: string; exchangeRate: string; allocatedCost: string
  quantity: number; actorId: string; ratePolicy?: string
}
export interface LedgerHooks {
  /** Test interleavings observe real transactions; no database behavior is replaced. */
  event?(name: string, data: Row): void | Promise<void>
  afterBalanceUpdate?(batch: Batch): void | Promise<void>
}
const movementTypes = new Set(["receipt", "reservation", "reservation_release", "allocation_conversion", "fulfillment", "return_quarantine", "return_restock", "damage_writeoff", "expiry_quarantine", "manual_correction"])
const conflict = (code: string) => new MedusaError(MedusaError.Types.CONFLICT, code, code)
const divergence = () => new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "INVENTORY_LEDGER_DIVERGENCE", "INVENTORY_LEDGER_DIVERGENCE")
const rows = async <T>(tx: Sql, text: string, values: unknown[] = []) => (await tx.raw(text, values)).rows as T[]
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const quantity = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Quantity must be a positive PostgreSQL integer")
  return value
}
const decimal4 = (value: string, signed = false) => {
  const match = value.match(/^(-?)(\d{1,8})(?:\.(\d{1,4}))?$/)
  if (!match) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Exact decimal(12,4) is required")
  if (match[1] && !signed) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Negative amount is not permitted")
  const normalized = BigInt(match[2]).toString() + "." + (match[3] || "").padEnd(4, "0")
  return match[1] && normalized !== "0.0000" ? "-" + normalized : normalized
}

/** Canonical UTF-8 compact tuple, shared by every movement producer. */
export function movementDedupKey(movementType: string, batchId: string, referenceType: string, referenceId: string, operationSubkey = "") {
  if (!movementTypes.has(movementType)) throw new Error("Unsupported inventory movement type")
  const digest = createHash("sha256").update(JSON.stringify(["inv-v1", movementType, batchId, referenceType, referenceId, operationSubkey]), "utf8").digest("hex")
  return `inv:v1:${movementType}:${digest}`
}

/** Minimal pre-order inventory primitive; order-scoped conversion/recovery is separate. */
export class InventoryLedger {
  private readonly db: Sql
  constructor(private readonly container: MedusaContainer, private readonly hooks: LedgerHooks = {}) {
    this.db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as Sql
  }

  private async transaction<T>(job: (tx: Sql) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.raw("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
      const [backend] = await rows<{ pid: number }>(tx, "SELECT pg_backend_pid() AS pid")
      await this.hooks.event?.("transaction_started", backend)
      return job(tx)
    })
  }

  private async movement(tx: Sql, batch: Batch, type: string, referenceType: string, referenceId: string) {
    const key = movementDedupKey(type, batch.id, referenceType, referenceId)
    return (await rows<Movement>(tx, "SELECT * FROM inventory_movement WHERE deduplication_key=?", [key]))[0]
  }

  private verifyMovement(movement: Movement, batch: Batch, type: string, referenceType: string, referenceId: string,
    deltas: [number, number, number], actorId: string, reason: string | null = null) {
    if (movement.batch_id !== batch.id || movement.variant_id !== batch.variant_id || movement.movement_type !== type ||
      movement.reference_type !== referenceType || movement.reference_id !== referenceId || movement.actor_id !== actorId || movement.reason !== reason ||
      movement.quantity_on_hand_delta !== deltas[0] || movement.quantity_reserved_delta !== deltas[1] || movement.quantity_quarantined_delta !== deltas[2]) {
      throw conflict("INVENTORY_MOVEMENT_INTENT_CONFLICT")
    }
  }

  private async assertLedgerBalance(tx: Sql, batch: Batch) {
    const [sum] = await rows<{ hand: string; reserved: string; quarantined: string }>(tx, `SELECT
      COALESCE(SUM(quantity_on_hand_delta),0)::text AS hand,
      COALESCE(SUM(quantity_reserved_delta),0)::text AS reserved,
      COALESCE(SUM(quantity_quarantined_delta),0)::text AS quarantined
      FROM inventory_movement WHERE batch_id=?`, [batch.id])
    if (BigInt(sum.hand) !== BigInt(batch.quantity_on_hand) || BigInt(sum.reserved) !== BigInt(batch.quantity_reserved) || BigInt(sum.quarantined) !== BigInt(batch.quantity_quarantined)) throw divergence()
  }

  private async mutate(tx: Sql, batch: Batch, type: string, referenceType: string, referenceId: string,
    deltas: [number, number, number], actorId: string) {
    const existing = await this.movement(tx, batch, type, referenceType, referenceId)
    if (existing) {
      this.verifyMovement(existing, batch, type, referenceType, referenceId, deltas, actorId)
      // Replay must be recognized by the producer's already-committed state,
      // never by silently accepting a movement alongside an uncommitted state.
      throw divergence()
    }
    await this.assertLedgerBalance(tx, batch)
    const [after] = await rows<Batch>(tx, `UPDATE inventory_batch SET
      quantity_on_hand=quantity_on_hand+?, quantity_reserved=quantity_reserved+?,
      quantity_quarantined=quantity_quarantined+?, updated_at=NOW()
      WHERE id=? RETURNING *, expiration_date::text AS expiration_date, production_date::text AS production_date`, [...deltas, batch.id])
    await this.hooks.afterBalanceUpdate?.(after)
    const key = movementDedupKey(type, batch.id, referenceType, referenceId)
    const [movement] = await rows<Movement>(tx, `INSERT INTO inventory_movement
      (id,deduplication_key,batch_id,variant_id,movement_type,
       quantity_on_hand_delta,quantity_reserved_delta,quantity_quarantined_delta,
       quantity_on_hand_before,quantity_on_hand_after,quantity_reserved_before,quantity_reserved_after,
       quantity_quarantined_before,quantity_quarantined_after,reference_type,reference_id,actor_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`, [
      "mov_" + randomUUID(), key, batch.id, batch.variant_id, type, ...deltas,
      batch.quantity_on_hand, after.quantity_on_hand, batch.quantity_reserved, after.quantity_reserved,
      batch.quantity_quarantined, after.quantity_quarantined, referenceType, referenceId, actorId,
    ])
    Object.assign(batch, after)
    await this.hooks.event?.("movement_inserted", { batchId: batch.id, movementId: movement.id, type })
    return movement
  }

  async receiveBatch(input: IntakeInput) {
    quantity(input.quantity)
    await this.container.resolve(Modules.PRODUCT).retrieveProductVariant(input.variantId)
    for (const value of [input.batchNumber,input.invoiceReference,input.actorId]) {
      if (!value.trim()) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Nonempty receipt metadata is required")
    }
    if (!uuid(input.receiptOperationId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.expirationDate)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Receipt UUID/date is invalid")
    const price = decimal4(input.purchasePrice), rate = decimal4(input.exchangeRate), allocated = decimal4(input.allocatedCost, true)
    const policy = input.ratePolicy || "customs_clearance_date"
    return this.transaction(async (tx) => {
      await tx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", ["zamzam:receipt:" + input.receiptOperationId])
      let [batch] = await rows<Batch>(tx, "SELECT *, expiration_date::text AS expiration_date, production_date::text AS production_date FROM inventory_batch WHERE receipt_operation_id=? FOR UPDATE", [input.receiptOperationId])
      if (batch) {
        const expected: Row = { variant_id: input.variantId, location_id: input.locationId, supplier_id: input.supplierId,
          batch_number: input.batchNumber, supplier_invoice_reference: input.invoiceReference,
          production_date: input.productionDate || null, expiration_date: input.expirationDate,
          purchase_currency: input.purchaseCurrency, purchase_price_raw: price, exchange_rate_to_egp: rate,
          unit_cost_allocated: allocated, rate_determination_policy: policy }
        if (Object.entries(expected).some(([key,value]) => batch[key] !== value)) throw conflict("BATCH_RECEIPT_INTENT_CONFLICT")
        const movement = await this.movement(tx, batch, "receipt", "receipt", input.receiptOperationId)
        if (!movement) throw divergence()
        this.verifyMovement(movement, batch, "receipt", "receipt", input.receiptOperationId, [input.quantity,0,0], input.actorId)
        await this.assertLedgerBalance(tx, batch)
        return { batch, movement, replay: true }
      }
      const inserted = await rows<Batch>(tx, `INSERT INTO inventory_batch
        (id,variant_id,location_id,supplier_id,batch_number,supplier_invoice_reference,receipt_operation_id,
         production_date,expiration_date,purchase_currency,purchase_price_raw,exchange_rate_to_egp,
         rate_determination_policy,unit_cost_purchase,unit_cost_allocated,unit_cost_final)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,(?::numeric * ?::numeric)::numeric(12,4),?,
          ((?::numeric * ?::numeric)::numeric(12,4) + ?::numeric))
        RETURNING *, expiration_date::text AS expiration_date, production_date::text AS production_date`, [
        "bat_" + randomUUID(), input.variantId, input.locationId, input.supplierId, input.batchNumber,
        input.invoiceReference, input.receiptOperationId, input.productionDate || null, input.expirationDate,
        input.purchaseCurrency, price, rate, policy, price, rate, allocated, price, rate, allocated,
      ])
      batch = inserted[0]
      const movement = await this.mutate(tx, batch, "receipt", "receipt", input.receiptOperationId, [input.quantity,0,0], input.actorId)
      return { batch, movement, replay: false }
    })
  }

  private async assertRedisOwner(input: InventoryAuthority) {
    // Owner introspection is the same pinned 2.22.1 provider seam verified by
    // TP-02a/02b; the public locking interface has no ownership-read method.
    const locking = this.container.resolve(Modules.LOCKING) as unknown as InspectedLockingModule
    const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
    const owner = await provider.redisClient.get(provider.keyNamePrefix + "cart:" + input.cartId)
    if (owner !== input.ownerId) throw conflict("CART_LOCK_OWNER_MISMATCH")
  }

  private async assertLease(tx: Sql, input: InventoryAuthority, idempotencyKey: string) {
    const result = await tx.raw(`SELECT key FROM idempotency_key WHERE key=? AND lease_owner_id=?
      AND status='pending' AND deleted_at IS NULL AND last_heartbeat_at>NOW()-INTERVAL '120 seconds'`, [idempotencyKey,input.ownerId])
    if (result.rowCount !== 1) throw conflict("CHECKOUT_LEASE_NOT_OWNED")
  }

  private async lockPreOrderAuthority(tx: Sql, input: InventoryAuthority) {
    const [session] = await rows<Row>(tx, "SELECT * FROM cart_checkout_session WHERE cart_id=? AND deleted_at IS NULL FOR UPDATE", [input.cartId])
    if (!session || session.current_attempt_id !== input.attemptId || session.epoch !== input.epoch || session.status !== "in_progress") throw conflict("STALE_CHECKOUT_EPOCH")
    const [attempt] = await rows<Row>(tx, "SELECT * FROM cart_checkout_attempt WHERE checkout_attempt_id=?::uuid FOR UPDATE", [input.attemptId])
    if (!attempt || attempt.cart_id !== input.cartId || Number(attempt.epoch) !== input.epoch || attempt.lease_owner_id !== input.ownerId) throw conflict("CHECKOUT_ATTEMPT_NOT_OWNED")
    // Never acquire an order advisory lock after session/attempt row locks.
    // Existing or uncertain orders require the separate order-rooted protocol.
    if (attempt.order_id || attempt.order_correlation_status !== "none" || !["initiated","reserved"].includes(String(attempt.attempt_status))) throw conflict("CHECKOUT_ORDER_SCOPE_REQUIRED")
    await this.assertLease(tx, input, String(attempt.idempotency_key))
    await this.hooks.event?.("pre_order_authority_locked", { cartId: input.cartId, epoch: input.epoch })
    return attempt
  }

  async reserveCart(input: InventoryAuthority) {
    await this.assertRedisOwner(input)
    const cart = await this.container.resolve(Modules.CART).retrieveCart(input.cartId, { relations: ["items"] })
    if (!cart.items?.length) throw conflict("CART_HAS_NO_RESERVABLE_LINES")
    const lines: { id: string; key: string; variantId: string; quantity: number; days: number }[] = []
    const keys = new Set<string>()
    for (const item of cart.items) {
      const key = item.metadata?.checkout_line_key
      if (typeof key !== "string" || !uuid(key) || keys.has(key) || !item.variant_id) throw conflict("AMBIGUOUS_LINE_MAPPING")
      keys.add(key)
      const variant = await this.container.resolve(Modules.PRODUCT).retrieveProductVariant(item.variant_id)
      const packaging = variant.metadata?.packaging as Row | undefined
      const rawDays = packaging?.min_shelf_life_days
      const days = typeof rawDays === "number" ? rawDays : typeof rawDays === "string" && /^(0|[1-9]\d*)$/.test(rawDays) ? Number(rawDays) : NaN
      if (variant.manage_inventory !== false || !Number.isSafeInteger(days) || days < 0) throw conflict("INVALID_BATCH_VARIANT_STRATEGY")
      lines.push({ id: item.id, key, variantId: item.variant_id, quantity: quantity(Number(item.quantity)), days })
    }
    return this.transaction(async (tx) => {
      const attempt = await this.lockPreOrderAuthority(tx, input)
      const variantIds = [...new Set(lines.map((line) => line.variantId))]
      // Candidate read is non-locking. All affected batches are then locked in
      // ascending ID order before any reservation child is locked or changed.
      const candidates = await rows<{ id: string }>(tx, "SELECT id FROM inventory_batch WHERE variant_id=ANY(?::text[]) ORDER BY id", [variantIds])
      const batches = candidates.length ? await rows<Batch>(tx, "SELECT *, expiration_date::text AS expiration_date FROM inventory_batch WHERE id=ANY(?::text[]) ORDER BY id FOR UPDATE", [candidates.map((row) => row.id)]) : []
      await this.hooks.event?.("batches_locked_ascending", { batchIds: batches.map((batch) => batch.id) })
      const prior = await rows<Reservation>(tx, "SELECT *,expires_at>NOW() AS unexpired FROM cart_batch_reservation WHERE checkout_attempt_id=? ORDER BY id FOR UPDATE", [input.attemptId])
      if (prior.length && (new Set(prior.map((row) => row.checkout_line_key)).size !== keys.size || prior.some((row) => !keys.has(row.checkout_line_key)))) throw conflict("RESERVATION_INTENT_CONFLICT")
      if (!prior.length && attempt.attempt_status === "reserved") throw divergence()
      const output = []
      for (const line of lines) {
        const existing = prior.filter((row) => row.checkout_line_key === line.key)
        if (existing.length) {
          if (existing.reduce((sum,row) => sum + row.quantity, 0) !== line.quantity || existing.some((row) => row.variant_id !== line.variantId || row.cart_line_item_id !== line.id || row.cart_id !== input.cartId || row.checkout_epoch !== input.epoch)) throw conflict("RESERVATION_INTENT_CONFLICT")
          for (const row of existing) {
            if (row.status !== "active" || row.unexpired !== true) throw divergence()
            const batch = batches.find((entry) => entry.id === row.batch_id)
            if (!batch) throw divergence()
            const movement = await this.movement(tx, batch, "reservation", "cart_reservation", row.id)
            if (!movement) throw divergence()
            this.verifyMovement(movement, batch, "reservation", "cart_reservation", row.id, [0,row.quantity,0], "SYSTEM")
            await this.assertLedgerBalance(tx, batch)
            output.push({ reservation: row, movement, replay: true })
          }
          continue
        }
        const eligible = await rows<{ id: string }>(tx, `SELECT b.id FROM inventory_batch b
          JOIN supplier s ON s.id=b.supplier_id JOIN inventory_location l ON l.id=b.location_id
          WHERE b.id=ANY(?::text[]) AND b.variant_id=? AND b.status='available' AND s.is_active AND l.is_active
          AND b.expiration_date>((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date + (? * INTERVAL '1 day'))
          ORDER BY b.expiration_date,b.id`, [batches.map((batch) => batch.id),line.variantId,line.days])
        let remaining = line.quantity
        for (const candidate of eligible) {
          const batch = batches.find((entry) => entry.id === candidate.id)!
          const amount = Math.min(remaining, batch.quantity_on_hand-batch.quantity_reserved-batch.quantity_quarantined)
          if (amount <= 0) continue
          const [reservation] = await rows<Reservation>(tx, `INSERT INTO cart_batch_reservation
            (id,checkout_attempt_id,cart_id,checkout_line_key,checkout_epoch,cart_line_item_id,variant_id,batch_id,quantity,unit_cost_snapshot,status,expires_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,'active',NOW()+INTERVAL '15 minutes') RETURNING *`, [
            "cbr_" + randomUUID(), input.attemptId, input.cartId, line.key, input.epoch, line.id, line.variantId, batch.id, amount, batch.unit_cost_final,
          ])
          const movement = await this.mutate(tx, batch, "reservation", "cart_reservation", reservation.id, [0,amount,0], "SYSTEM")
          output.push({ reservation, movement, replay: false })
          remaining -= amount
          if (!remaining) break
        }
        if (remaining) throw conflict("INSUFFICIENT_BATCH_STOCK")
      }
      await this.assertRedisOwner(input)
      await this.assertLease(tx, input, String(attempt.idempotency_key))
      await tx.raw("UPDATE cart_checkout_attempt SET attempt_status='reserved',updated_at=NOW() WHERE checkout_attempt_id=?::uuid AND attempt_status='initiated'", [input.attemptId])
      return output
    })
  }

  async cleanupExpired(input: InventoryAuthority) {
    await this.assertRedisOwner(input)
    return this.transaction(async (tx) => {
      const attempt = await this.lockPreOrderAuthority(tx, input)
      const candidateIds = await rows<{ batch_id: string }>(tx, "SELECT DISTINCT batch_id FROM cart_batch_reservation WHERE checkout_attempt_id=? ORDER BY batch_id", [input.attemptId])
      const batches = candidateIds.length ? await rows<Batch>(tx, "SELECT *,expiration_date::text AS expiration_date FROM inventory_batch WHERE id=ANY(?::text[]) ORDER BY id FOR UPDATE", [candidateIds.map((row) => row.batch_id)]) : []
      await this.hooks.event?.("cleanup_batches_locked_ascending", { batchIds: batches.map((batch) => batch.id) })
      const reservations = await rows<Reservation>(tx, `SELECT * FROM cart_batch_reservation WHERE checkout_attempt_id=?
        AND expires_at<NOW() ORDER BY id FOR UPDATE`, [input.attemptId])
      const output = []
      for (const row of reservations) {
        if (row.status === "converted" || row.status === "released") continue
        const batch = batches.find((entry) => entry.id === row.batch_id)
        if (!batch || row.cart_id !== input.cartId || row.checkout_epoch !== input.epoch) throw divergence()
        const existing = await this.movement(tx, batch, "reservation_release", "cleanup", row.id)
        if (existing) {
          this.verifyMovement(existing, batch, "reservation_release", "cleanup", row.id, [0,-row.quantity,0], "SYSTEM")
          if (row.status !== "expired") throw divergence()
          await this.assertLedgerBalance(tx, batch)
          output.push({ reservation: row, movement: existing, replay: true })
          continue
        }
        if (row.status !== "active") throw divergence()
        const movement = await this.mutate(tx, batch, "reservation_release", "cleanup", row.id, [0,-row.quantity,0], "SYSTEM")
        const [after] = await rows<Reservation>(tx, "UPDATE cart_batch_reservation SET status='expired',updated_at=NOW() WHERE id=? AND status='active' RETURNING *", [row.id])
        if (!after) throw divergence()
        output.push({ reservation: after, movement, replay: false })
      }
      await this.assertRedisOwner(input)
      await this.assertLease(tx, input, String(attempt.idempotency_key))
      return output
    })
  }
}

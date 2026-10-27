/**
 * TP-08a/08b authoritative attempt fencing and order-correlation foundation.
 *
 * This component intentionally does not fabricate native Medusa orders or a
 * complete-cart workflow result. The caller must supply the real native
 * completeCartWorkflow.runAsStep({ input: { id: cartId } }) adapter and an
 * actual native order lookup by cart_id. These functions do not mutate stock.
 *
 * All uncertain outcomes are fenced; they are NEVER interpreted as failure.
 */
export class CorrelationConflict extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CorrelationConflict" }
}
type AuthorityRow = {
  cart_id: string; current_attempt_id: string; epoch: number | string; status: string;
  id: string; lease_owner_id: string; attempt_status: string; order_id: string | null;
  order_correlation_status: string; idempotency_key: string
}
type DbRow = Record<string, unknown>
type Sql = {
  raw(sql: string, values?: unknown[]): Promise<{ rows: DbRow[]; rowCount: number }>
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>
}
type Authority = { cartId: string; attemptId: string; epoch: number; ownerId: string }
type NativeOrder = { id: string; cart_id: string }
type Lookup = (cartId: string) => Promise<NativeOrder[]>
type Complete = (cartId: string) => Promise<{ orderId?: string | null; order_id?: string | null } | null | undefined>
const invalid = (code: string): never => { throw new CorrelationConflict(code) }
const validate = (x: Authority) => {
  if (!x.cartId || !x.attemptId || !x.ownerId || !Number.isSafeInteger(x.epoch) || x.epoch < 1) invalid("INVALID_AUTHORITY")
}
async function current(tx: Sql, x: Authority): Promise<AuthorityRow> {
  const session = (await tx.raw(`SELECT cart_id,current_attempt_id,epoch,status FROM cart_checkout_session
    WHERE cart_id=? AND deleted_at IS NULL FOR UPDATE`, [x.cartId])).rows[0] as
    { cart_id: string; current_attempt_id: string; epoch: number | string; status: string } | undefined
  const attempt = (await tx.raw(`SELECT checkout_attempt_id::text AS id,cart_id,epoch,idempotency_key,lease_owner_id,attempt_status,
    order_id,order_correlation_status FROM cart_checkout_attempt
    WHERE checkout_attempt_id=?::uuid FOR UPDATE`, [x.attemptId])).rows[0] as AuthorityRow | undefined
  const allocatedReplay = session?.status === "completed" && attempt?.attempt_status === "allocated" &&
    Boolean(attempt?.order_id) && attempt?.order_correlation_status === "correlated"
  if (!session || !attempt || session.current_attempt_id !== x.attemptId ||
      Number(session.epoch) !== x.epoch || (session.status !== "in_progress" && !allocatedReplay) ||
      attempt.cart_id !== x.cartId || Number(attempt.epoch) !== x.epoch ||
      attempt.lease_owner_id !== x.ownerId) {
    throw new CorrelationConflict("STALE_OR_UNAUTHORIZED_ATTEMPT")
  }
  return attempt
}

/** Commit the durable fence BEFORE any native complete-cart invocation. */
export async function markOrderCreationStarted(db: Sql, authority: Authority) {
  validate(authority)
  return db.transaction(async (tx) => {
    // Revision 18: a replay for an already bound order must take its order
    // advisory root before locking checkout authority. If the binding changes
    // between this read and the row lock, fail closed instead of taking a new
    // root after session/attempt locks.
    const observed = (await tx.raw(
      "SELECT order_id FROM cart_checkout_attempt WHERE checkout_attempt_id=?::uuid",
      [authority.attemptId]
    )).rows[0] as { order_id: string | null } | undefined
    if (observed?.order_id) {
      await tx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
        ["phase0:order:" + observed.order_id])
    }
    const a = await current(tx, authority)
    if (a.order_id !== (observed?.order_id ?? null)) invalid("ORDER_ROOT_CHANGED_DURING_RECONCILIATION")
    const completedReplay = a.attempt_status === "allocated" && a.order_id !== null
    const lease = (await tx.raw(`SELECT key,status FROM idempotency_key WHERE key=? AND lease_owner_id=?
      AND status IN ('pending','completed') AND deleted_at IS NULL
      AND (status='completed' OR last_heartbeat_at>NOW()-INTERVAL '120 seconds')`,
      [a.idempotency_key, authority.ownerId])).rows[0]
    if (!lease || (lease.status === "completed" && !completedReplay)) invalid("CHECKOUT_LEASE_NOT_OWNED")
    // An already correlated attempt must be replay-safe: never invoke the
    // native order creation workflow a second time. Reconciliation below
    // independently rechecks the existing native cart/order link.
    if (a.order_id) {
      if (!["order_created", "allocated"].includes(a.attempt_status) || a.order_correlation_status !== "correlated")
        invalid("BOUND_ORDER_STATE_DIVERGENCE")
      return { fenced: true, replay: true }
    }
    if ((a.attempt_status === "order_creation_started" && a.order_correlation_status === "pending_correlation") ||
        (a.attempt_status === "needs_reconciliation" && a.order_correlation_status === "needs_reconciliation"))
      return { fenced: true, replay: true }
    if (!["reserved"].includes(a.attempt_status) || a.order_correlation_status !== "none")
      invalid("INVALID_START_STATE")
    const result = await tx.raw(`UPDATE cart_checkout_attempt SET attempt_status='order_creation_started',
      order_correlation_status='pending_correlation',updated_at=NOW()
      WHERE checkout_attempt_id=?::uuid AND attempt_status='reserved'
        AND order_correlation_status='none' AND order_id IS NULL`, [authority.attemptId])
    if (result.rowCount !== 1) invalid("START_FENCE_CAS_FAILED")
    return { fenced: true, replay: false }
  })
}

/**
 * Bind only a single compatible native order. The list MUST be returned from
 * an authoritative native Medusa order/cart correlation query, not user input.
 * The separate lookup is deliberately outside the transaction: the CAS below
 * rechecks session/attempt authority and remains safe against stale workers.
 */
export async function reconcileOrderCreation(db: Sql, authority: Authority, lookup: Lookup) {
  validate(authority)
  const orders = await lookup(authority.cartId)
  if (!Array.isArray(orders)) invalid("INVALID_ORDER_LOOKUP_RESULT")
  const unique = new Map<string,NativeOrder>()
  for (const o of orders) {
    if (typeof o?.id !== "string" || !o.id || o.cart_id !== authority.cartId) invalid("INVALID_NATIVE_ORDER_CANDIDATE")
    unique.set(o.id, o)
  }
  return db.transaction(async (tx) => {
    // Rev 18: any operation acting on an existing order takes the order root
    // before checkout session/attempt row locks. The native lookup is outside
    // the transaction; the authority is rechecked under the row locks below.
    let lockedOrderId: string | null = null
    if (unique.size === 1) {
      const [orderId] = unique.keys()
      lockedOrderId = orderId
      await tx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", ["phase0:order:" + orderId])
    } else {
      // Do not lock arbitrary candidate order IDs for ambiguous correlation:
      // fence the attempt and require manual recovery instead.
      const observed = (await tx.raw(
        "SELECT order_id FROM cart_checkout_attempt WHERE checkout_attempt_id=?::uuid",
        [authority.attemptId]
      )).rows[0] as { order_id: string | null } | undefined
      if (observed?.order_id) {
        lockedOrderId = observed.order_id
        await tx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
          ["phase0:order:" + observed.order_id])
      }
    }
    const a = await current(tx, authority)
    // Never lock the session/attempt and only then discover a different order
    // root. If correlation changed concurrently, abort instead of proceeding.
    if (a.order_id && a.order_id !== lockedOrderId) invalid("ORDER_ROOT_CHANGED_DURING_RECONCILIATION")
    if (a.order_id && (unique.size !== 1 || !unique.has(a.order_id)) &&
        a.order_correlation_status === "correlated") invalid("BOUND_ORDER_LOOKUP_DIVERGENCE")
    if (!["order_creation_started","order_created","allocated","needs_reconciliation"].includes(a.attempt_status))
      invalid("NOT_IN_ORDER_CREATION_PHASE")
    if (a.order_id) {
      if (unique.size === 1 && unique.has(a.order_id)) return { status: "correlated", orderId: a.order_id, replay: true }
      invalid("BOUND_ORDER_LOOKUP_DIVERGENCE")
    }
    if (!["pending_correlation","needs_reconciliation"].includes(a.order_correlation_status))
      invalid("CORRELATION_FENCE_MISSING")
    if (unique.size !== 1) {
      const result = await tx.raw(`UPDATE cart_checkout_attempt
        SET attempt_status='needs_reconciliation',order_correlation_status='needs_reconciliation',updated_at=NOW()
        WHERE checkout_attempt_id=?::uuid AND order_id IS NULL AND
        order_correlation_status IN ('pending_correlation','needs_reconciliation')`,[authority.attemptId])
      if (result.rowCount !== 1) invalid("RECONCILIATION_CAS_FAILED")
      return { status: unique.size === 0 ? "needs_reconciliation" : "ambiguous", orderId: null, replay: false }
    }
    const orderId = [...unique.keys()][0]
    const changed = await tx.raw(`UPDATE cart_checkout_attempt
      SET order_id=?,attempt_status='order_created',order_correlation_status='correlated',updated_at=NOW()
      WHERE checkout_attempt_id=?::uuid AND order_id IS NULL
      AND order_correlation_status IN ('pending_correlation','needs_reconciliation')`,[orderId,authority.attemptId])
    if (changed.rowCount !== 1) invalid("ORDER_BIND_CAS_FAILED")
    return {status:"correlated",orderId,replay:false}
  })
}

/**
 * The caller must provide the real native workflow adapter and a real native
 * order lookup. Even if the native workflow throws, we reconcile by cart ID.
 * No repeat native order-creation call is permitted after a durable start fence.
 */
export async function runOrderCreationWithFence(db: Sql, authority: Authority,
  runNativeCompleteCart: Complete, lookup: Lookup) {
  const started = await markOrderCreationStarted(db, authority)
  if (!started.replay) {
    try {
      await runNativeCompleteCart(authority.cartId)
    } catch {
      // Unknown native workflow outcome: NEVER roll back the durable fence.
    }
  }
  return reconcileOrderCreation(db, authority, lookup)
}

export const CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS = 30_000
export const CHECKOUT_LOCK_TTL_SECONDS = 120

export type CheckoutLockHeartbeatOutcome =
  | { status: "renewed"; heartbeatUpdatedRows: number }
  | { status: "lock_lost"; reason: "LOCK_LOST" | "REDIS_ERROR" | "LEASE_NOT_PENDING" }
  | { status: "stopped" }

export interface IdempotencyLeaseHeartbeatWriter {
  updateHeartbeat(input: {
    key: string
    leaseOwnerId: string
  }): Promise<{ rowCount: number }>
}

export interface CheckoutLockHeartbeatDependencies {
  extendLock(key: string, ownerId: string, ttlSeconds: number): Promise<number>
  leaseWriter: IdempotencyLeaseHeartbeatWriter
  abortController?: AbortController
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

/**
 * Coordinates a durable checkout lease with its Redis cart lock. Redis renewal
 * is deliberately first: a worker that cannot prove continued lock ownership
 * is forbidden from renewing the PostgreSQL lease.
 *
 * This is a worker primitive, not an HTTP endpoint. The checkout workflow
 * must own its lifecycle and stop it before releasing the cart lock.
 */
export class CheckoutLockHeartbeat {
  readonly abortController: AbortController

  private readonly extendLock: CheckoutLockHeartbeatDependencies["extendLock"]
  private readonly leaseWriter: IdempotencyLeaseHeartbeatWriter
  private readonly setIntervalFn: typeof setInterval
  private readonly clearIntervalFn: typeof clearInterval
  private timer: ReturnType<typeof setInterval> | undefined
  private inFlight: Promise<CheckoutLockHeartbeatOutcome> | undefined
  private state: "active" | "aborted" | "stopped" = "active"

  constructor(
    private readonly input: {
      lockKey: string
      ownerId: string
      idempotencyKey: string
      ttlSeconds?: number
    },
    dependencies: CheckoutLockHeartbeatDependencies
  ) {
    this.extendLock = dependencies.extendLock
    this.leaseWriter = dependencies.leaseWriter
    this.abortController = dependencies.abortController ?? new AbortController()
    this.setIntervalFn = dependencies.setIntervalFn ?? setInterval
    this.clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval
  }

  start(): void {
    if (this.timer || this.state !== "active") {
      return
    }

    this.timer = this.setIntervalFn(() => {
      void this.tick()
    }, CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.timer) {
      this.clearIntervalFn(this.timer)
      this.timer = undefined
    }
    if (this.state === "active") {
      this.state = "stopped"
    }
    await this.inFlight
  }

  async tick(): Promise<CheckoutLockHeartbeatOutcome> {
    if (this.state !== "active") {
      return { status: "stopped" }
    }

    if (this.inFlight) {
      return this.inFlight
    }

    this.inFlight = this.runTick()
    try {
      return await this.inFlight
    } finally {
      this.inFlight = undefined
    }
  }

  private async runTick(): Promise<CheckoutLockHeartbeatOutcome> {
    let extensionResult: number
    try {
      extensionResult = await this.extendLock(
        this.input.lockKey,
        this.input.ownerId,
        this.input.ttlSeconds ?? CHECKOUT_LOCK_TTL_SECONDS
      )
    } catch {
      return this.abort("REDIS_ERROR")
    }

    if (extensionResult !== 1) {
      return this.abort("LOCK_LOST")
    }

    let updateResult: { rowCount: number }
    try {
      updateResult = await this.leaseWriter.updateHeartbeat({
        key: this.input.idempotencyKey,
        leaseOwnerId: this.input.ownerId,
      })
    } catch {
      return this.abort("LEASE_NOT_PENDING")
    }

    if (updateResult.rowCount !== 1) {
      return this.abort("LEASE_NOT_PENDING")
    }

    return { status: "renewed", heartbeatUpdatedRows: updateResult.rowCount }
  }

  private abort(reason: "LOCK_LOST" | "REDIS_ERROR" | "LEASE_NOT_PENDING"): CheckoutLockHeartbeatOutcome {
    this.state = "aborted"
    if (this.timer) {
      this.clearIntervalFn(this.timer)
      this.timer = undefined
    }
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(reason)
    }
    return { status: "lock_lost", reason }
  }
}

export interface PostgreSqlQueryClient {
  query(
    text: string,
    values: readonly unknown[]
  ): Promise<{ rowCount: number | null }>
}

/**
 * Canonical guarded lease update. It intentionally does not mutate a lease
 * unless the calling worker still owns a pending idempotency record.
 */
export function createPostgresLeaseHeartbeatWriter(
  client: PostgreSqlQueryClient
): IdempotencyLeaseHeartbeatWriter {
  return {
    async updateHeartbeat({ key, leaseOwnerId }) {
      const result = await client.query(
        `UPDATE idempotency_key
         SET locked_at = NOW(),
             last_heartbeat_at = NOW(),
             updated_at = NOW()
         WHERE key = $1
           AND lease_owner_id = $2
           AND status = 'pending'`,
        [key, leaseOwnerId]
      )
      return { rowCount: result.rowCount ?? 0 }
    },
  }
}

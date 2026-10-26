import { createWorkflow, WorkflowResponse, createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { setTimeout as delay } from "node:timers/promises"

export interface Stage2CheckoutLockWorkflowInput {
  cartId: string
  ownerId: string
  ttl?: number
  timeout?: number
  retryInterval?: number
  idempotencyKey?: string
  pgClient?: { query: (text: string, values: unknown[]) => Promise<{ rowCount?: number | null }> }
}

export async function executeCasLeaseAbort(
  client: { query: (text: string, values: unknown[]) => Promise<{ rowCount?: number | null }> },
  key: string,
  ownerId: string
): Promise<{ deletedRows: number }> {
  const result = await client.query(
    "DELETE FROM idempotency_key WHERE key = $1 AND lease_owner_id = $2 AND status = 'pending'",
    [key, ownerId]
  )
  return { deletedRows: result.rowCount ?? 0 }
}

export async function abortPendingLeaseOnLockTimeout(
  input: Pick<Stage2CheckoutLockWorkflowInput, "idempotencyKey" | "ownerId" | "pgClient">,
  resolvePgConnection: () => { raw?: (text: string, values: unknown[]) => Promise<unknown> } | undefined
): Promise<void> {
  if (!input.idempotencyKey) return
  if (input.pgClient) {
    await executeCasLeaseAbort(input.pgClient, input.idempotencyKey, input.ownerId)
    return
  }

  const pg = resolvePgConnection()
  if (!pg?.raw) {
    throw new Error("PostgreSQL connection unavailable for idempotency lease CAS abort")
  }
  await pg.raw(
    "DELETE FROM idempotency_key WHERE key = ? AND lease_owner_id = ? AND status = 'pending'",
    [input.idempotencyKey, input.ownerId]
  )
}

export function isLockContentionError(err: unknown): boolean {
  if (!err) return false
  const isMedusaConflict =
    (err instanceof MedusaError || (err as { name?: string }).name === "MedusaError") &&
    (err as { type?: string }).type === MedusaError.Types.CONFLICT
  const message = (err as { message?: string }).message
  const isAcquisitionFailure =
    typeof message === "string" && message.startsWith("Failed to acquire lock for key ")
  return Boolean(isMedusaConflict && isAcquisitionFailure)
}

export const stage2AcquireLockStep = createStep<
  Stage2CheckoutLockWorkflowInput,
  { key: string; ownerId: string },
  { key: string; ownerId: string } | undefined
>(
  "stage2-acquire-lock-step",
  async (input, { container }) => {
    const locking = container.resolve(Modules.LOCKING)
    const lockKey = "cart:" + input.cartId
    const timeout = input.timeout ?? 5
    const ttl = input.ttl ?? 120
    const retryInterval = input.retryInterval ?? 0.3
    const tryUntil = Date.now() + timeout * 1000

    let acquired = false
    while (!acquired) {
      try {
        await locking.acquire(lockKey, {
          expire: ttl,
          ownerId: input.ownerId,
        })
        acquired = true
      } catch (err) {
        if (!isLockContentionError(err)) {
          throw err
        }
        if (Date.now() >= tryUntil) {
          await abortPendingLeaseOnLockTimeout(input, () =>
            container.resolve(ContainerRegistrationKeys.PG_CONNECTION) ||
            container.resolve("__pg_connection__")
          )
          throw new MedusaError(
            MedusaError.Types.CONFLICT,
            "Cart checkout lock timeout",
            "LOCK_TIMEOUT"
          )
        }
      }
      if (!acquired) {
        await delay(retryInterval * 1000)
      }
    }

    return new StepResponse(
      { key: lockKey, ownerId: input.ownerId },
      { key: lockKey, ownerId: input.ownerId }
    )
  },
  async (compensationData, { container }) => {
    if (!compensationData?.key) return
    const locking = container.resolve(Modules.LOCKING)
    await locking.release(compensationData.key, {
      ownerId: compensationData.ownerId,
    })
  }
)

export const stage2CheckoutLockWorkflow = createWorkflow(
  "stage2CheckoutLockWorkflow",
  (input: Stage2CheckoutLockWorkflowInput) => {
    const lock = stage2AcquireLockStep(input)
    return new WorkflowResponse(lock)
  }
)

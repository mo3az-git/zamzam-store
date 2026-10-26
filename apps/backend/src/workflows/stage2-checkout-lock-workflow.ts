import { createWorkflow, WorkflowResponse, createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { setTimeout as delay } from "node:timers/promises"

export interface Stage2CheckoutLockWorkflowInput {
  cartId: string
  ownerId: string
  ttl?: number
  timeout?: number
  retryInterval?: number
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

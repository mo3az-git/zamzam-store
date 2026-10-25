import { Modules, isDefined } from "@medusajs/framework/utils"
import { createStep, StepResponse, StepFunction } from "@medusajs/framework/workflows-sdk"
import { setTimeout as delay } from "node:timers/promises"

export interface AcquireLockStepInput {
  key?: string | string[]
  cartId?: string
  ttl?: number
  timeout?: number
  retryInterval?: number
  ownerId?: string
  provider?: string
  executeOnSubWorkflow?: boolean
}

export interface AcquireLockStepResult {
  key: string | string[]
  ownerId?: string
  acquired: boolean
  skipped: boolean
}

export interface AcquireLockStepCompensation {
  keys: string[]
  ownerId?: string
  provider?: string
}

export interface ReleaseLockStepInput {
  key?: string | string[]
  cartId?: string
  ownerId?: string
  provider?: string
  executeOnSubWorkflow?: boolean
}

export const acquireLockStepId = "acquire-lock-step"

function resolveKeys(input: { key?: string | string[]; cartId?: string }): string[] {
  let rawKeys = input.key
  if (!rawKeys && input.cartId) {
    rawKeys = `cart:${input.cartId}`
  }
  if (!rawKeys) {
    return []
  }
  return Array.isArray(rawKeys)
    ? rawKeys.filter((k) => isDefined(k) && k.length > 0)
    : [rawKeys]
}

export const acquireLockStep: StepFunction<AcquireLockStepInput, AcquireLockStepResult> = createStep(
  acquireLockStepId,
  async (input: AcquireLockStepInput, { container, parentStepIdempotencyKey }) => {
    const keys = resolveKeys(input)
    if (!keys.length) {
      return new StepResponse(
        {
          key: input.key ?? "",
          ownerId: input.ownerId,
          acquired: false,
          skipped: false,
        },
        {
          keys: [],
          ownerId: input.ownerId,
          provider: input.provider,
        }
      )
    }

    const isSubWorkflow = Boolean(parentStepIdempotencyKey)
    if (isSubWorkflow && !input.executeOnSubWorkflow) {
      return StepResponse.skip() as unknown as StepResponse<AcquireLockStepResult, AcquireLockStepCompensation>
    }

    const locking = container.resolve(Modules.LOCKING)
    const ttl = input.ttl ?? 120
    const timeout = input.timeout ?? 5
    const retryInterval = input.retryInterval ?? 0.3
    const tryUntil = Date.now() + timeout * 1000

    let acquired = false
    while (!acquired) {
      try {
        await locking.acquire(keys, {
          expire: ttl,
          ownerId: input.ownerId,
          provider: input.provider,
        })
        acquired = true
        break
      } catch (error) {
        if (Date.now() >= tryUntil) {
          throw error
        }
        await delay(retryInterval * 1000)
      }
    }

    return new StepResponse(
      {
        key: keys.length === 1 ? keys[0] : keys,
        ownerId: input.ownerId,
        acquired: true,
        skipped: false,
      },
      {
        keys,
        ownerId: input.ownerId,
        provider: input.provider,
      }
    )
  },
  async (compensationData: AcquireLockStepCompensation | undefined, { container }) => {
    if (!compensationData?.keys?.length) {
      return
    }
    const locking = container.resolve(Modules.LOCKING)
    await locking.release(compensationData.keys, {
      ownerId: compensationData.ownerId,
      provider: compensationData.provider,
    })
    return new StepResponse()
  }
)

export const releaseLockStepId = "release-lock-step"

export const releaseLockStep: StepFunction<ReleaseLockStepInput, boolean> = createStep(
  releaseLockStepId,
  async (input: ReleaseLockStepInput, { container, parentStepIdempotencyKey }) => {
    const keys = resolveKeys(input)
    if (!keys.length) {
      return new StepResponse(true)
    }

    const isSubWorkflow = Boolean(parentStepIdempotencyKey)
    if (isSubWorkflow && !input.executeOnSubWorkflow) {
      return StepResponse.skip() as unknown as StepResponse<boolean>
    }

    const locking = container.resolve(Modules.LOCKING)
    const released = await locking.release(keys, {
      ownerId: input.ownerId,
      provider: input.provider,
    })
    return new StepResponse(Boolean(released))
  }
)

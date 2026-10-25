import { createWorkflow, WorkflowResponse, createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "./steps/acquire-lock"
import RedisModule from "ioredis"

const Redis = (RedisModule as unknown as { default?: typeof RedisModule }).default ?? RedisModule

export interface TestTp02aWorkflowInput {
  key?: string
  cartId?: string
  ttl?: number
  timeout?: number
  ownerId: string
  nestedOwnerId?: string
  redisUrl?: string
}

export interface InspectRedisLockResult {
  actualKey: string
  exists: boolean
  owner: string | null
  ttl: number
}

export const inspectRedisLockStep = createStep<
  { key: string; expectedOwner: string; redisUrl?: string },
  InspectRedisLockResult,
  undefined
>(
  "inspect-redis-lock-step",
  async (input) => {
    const redisUrl =
      input.redisUrl ||
      process.env.LOCKING_REDIS_URL ||
      process.env.REDIS_URL ||
      "redis://127.0.0.1:6379"

    const client = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })
    client.on("error", () => {})
    await client.connect()

    try {
      const prefixedKey = "medusa_lock:" + input.key
      let actualKey = prefixedKey
      let exists = await client.exists(prefixedKey)
      if (!exists && (await client.exists(input.key))) {
        actualKey = input.key
        exists = 1
      }
      const owner = exists ? await client.get(actualKey) : null
      const ttl = exists ? await client.ttl(actualKey) : -2
      return new StepResponse({
        actualKey,
        exists: Boolean(exists),
        owner,
        ttl,
      })
    } finally {
      client.disconnect()
    }
  }
)

export const nestedCartTestWorkflow = createWorkflow(
  "nestedCartTestWorkflow",
  (input: { key?: string; cartId?: string; ownerId: string }) => {
    const lock = acquireLockStep({
      key: input.key,
      cartId: input.cartId,
      ownerId: input.ownerId,
      ttl: 120,
      timeout: 5,
    })
    return new WorkflowResponse({
      executed: true,
      nestedLock: lock,
    })
  }
)

export const parentCheckoutTestWorkflow = createWorkflow(
  "parentCheckoutTestWorkflow",
  (input: TestTp02aWorkflowInput) => {
    const parentLock = acquireLockStep({
      key: input.key,
      cartId: input.cartId,
      ttl: input.ttl ?? 120,
      timeout: input.timeout ?? 5,
      ownerId: input.ownerId,
    })

    const nestedResult = nestedCartTestWorkflow.runAsStep({
      input: {
        key: input.key,
        cartId: input.cartId,
        ownerId: input.nestedOwnerId ?? "worker-nested-sub-workflow",
      },
    })

    const inFlightInspection = inspectRedisLockStep({
      key: input.key ?? ("cart:" + (input.cartId ?? "")),
      expectedOwner: input.ownerId,
      redisUrl: input.redisUrl,
    })

    const releaseResult = releaseLockStep({
      key: input.key,
      cartId: input.cartId,
      ownerId: input.ownerId,
    })

    return new WorkflowResponse({
      parentLock,
      nestedResult,
      inFlightInspection,
      releaseResult,
    })
  }
)

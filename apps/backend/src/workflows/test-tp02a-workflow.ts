import { createWorkflow, WorkflowResponse, createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "./steps/acquire-lock"
import RedisModule from "ioredis"

const Redis = (RedisModule as unknown as { default?: typeof RedisModule }).default ?? RedisModule

export interface TestTp02aWorkflowInput {
  key: string
  ttl?: number
  timeout?: number
  ownerId: string
  nestedOwnerId?: string
  redisUrl?: string
}

export interface InspectRedisLockResult {
  actualKey: string | null
  exists: boolean
  owner: string | null
  ttl: number
  prefix: string | null
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
      // Discover the real physical key actually stored in Redis for the logical lock key
      const matchingKeys = await client.keys("*" + input.key)
      const matchingKey = matchingKeys.find((k) => k.endsWith(input.key)) || null

      if (matchingKey) {
        const owner = await client.get(matchingKey)
        const ttl = await client.ttl(matchingKey)
        const prefix = matchingKey.slice(0, matchingKey.length - input.key.length)
        return new StepResponse({
          actualKey: matchingKey,
          exists: true,
          owner,
          ttl,
          prefix,
        })
      }

      return new StepResponse({
        actualKey: null,
        exists: false,
        owner: null,
        ttl: -2,
        prefix: null,
      })
    } finally {
      client.disconnect()
    }
  }
)

export const nestedCartTestWorkflow = createWorkflow(
  "nestedCartTestWorkflow",
  (input: { key: string; ownerId: string }) => {
    const lock = acquireLockStep({
      key: input.key,
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
      ttl: input.ttl ?? 120,
      timeout: input.timeout ?? 5,
      ownerId: input.ownerId,
    })

    const nestedResult = nestedCartTestWorkflow.runAsStep({
      input: {
        key: input.key,
        ownerId: input.nestedOwnerId ?? "worker-nested-sub-workflow",
      },
    })

    const inFlightInspection = inspectRedisLockStep({
      key: input.key,
      expectedOwner: input.ownerId,
      redisUrl: input.redisUrl,
    })

    const releaseResult = releaseLockStep({
      key: input.key,
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

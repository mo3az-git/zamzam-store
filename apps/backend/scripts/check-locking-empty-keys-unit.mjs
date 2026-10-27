import assert from "node:assert/strict"
import { SafeRedisLockingProvider } from "../src/modules/locking-redis/index.mjs"

let redisCalls = 0
const provider = Object.create(SafeRedisLockingProvider.prototype)
Object.assign(provider, {
  keyNamePrefix: "unit:",
  waitLockingTimeout: 100,
  redisClient: { acquireManyLocks: async () => { redisCalls += 1 } },
})

await assert.rejects(
  provider.acquire_([], { ownerId: "empty-set-owner" }),
  /At least one nonempty lock key is required/
)
await assert.rejects(
  provider.acquire_("", { ownerId: "empty-key-owner" }),
  /At least one nonempty lock key is required/
)
await assert.rejects(
  provider.acquire_(["valid", "  "], { ownerId: "blank-key-owner" }),
  /At least one nonempty lock key is required/
)
assert.equal(redisCalls, 0, "Invalid lock input must be rejected before Redis is called")
console.log("PASS empty lock key sets fail closed before Redis invocation")

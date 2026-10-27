import assert from "node:assert/strict";
import { SafeRedisLockingProvider } from "../src/modules/locking-redis/index.mjs";

let redisCalls = 0;
const provider = Object.create(SafeRedisLockingProvider.prototype);
Object.assign(provider, {
  keyNamePrefix: "unit:",
  waitLockingTimeout: 100,
  redisClient: { acquireManyLocks: async () => { redisCalls += 1; } },
});

for (const keys of [[], "", "  ", ["valid", ""], ["  "], [null], [undefined]]) {
  await assert.rejects(
    provider.acquire_(keys, { ownerId: "invalid-key-owner" }),
    /At least one nonempty lock key is required/
  );
}
assert.equal(redisCalls, 0, "Invalid lock input must be rejected before Redis is called");
console.log("PASS empty and malformed lock keys fail closed before Redis invocation");

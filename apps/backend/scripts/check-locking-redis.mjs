import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const redisModule = require("ioredis");
const Redis = redisModule.default ?? redisModule;
const { RedisLockingProvider } = require("@medusajs/locking-redis/dist/services/redis-lock");

const redisUrl = process.env.LOCKING_REDIS_URL || process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("LOCKING_REDIS_URL or REDIS_URL must point to a disposable Redis instance.");
}

const runId = randomUUID();
const checks = [];
const redisOptions = {
  lazyConnect: true,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
};

function makePrefix(name) {
  return "phase1-spike:" + runId + ":" + name.replace(/[^a-z0-9-]/gi, "-") + ":";
}

async function cleanupPrefix(prefix) {
  let cleanupClient;
  try {
    cleanupClient = new Redis(redisUrl, redisOptions);
    cleanupClient.on("error", () => {});
    await cleanupClient.connect();
    let cursor = "0";
    do {
      const result = await cleanupClient.scan(cursor, "MATCH", prefix + "*", "COUNT", 100);
      cursor = result[0];
      if (result[1].length) {
        await cleanupClient.del(...result[1]);
      }
    } while (cursor !== "0");
  } catch (error) {
    console.error("[cleanup warning] " + prefix + ": " + error.message);
  } finally {
    cleanupClient?.disconnect();
  }
}

async function settleWithin(promise, timeoutMs) {
  let timeout;
  const observed = Promise.resolve(promise).then(
    (value) => ({ kind: "resolved", value }),
    (error) => ({ kind: "rejected", error })
  );
  const timed = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([observed, timed]);
  } finally {
    clearTimeout(timeout);
  }
}

async function check(name, test) {
  const prefix = makePrefix(name);
  const clients = [];
  const providers = [];
  const context = {
    prefix,
    clients,
    providers,
    async openClient() {
      const client = new Redis(redisUrl, redisOptions);
      client.on("error", () => {});
      clients.push(client);
      await client.connect();
      return client;
    },
    async openProvider(sharedPrefix = prefix) {
      const client = await this.openClient();
      const provider = new RedisLockingProvider(
        { redisClient: client, prefix: sharedPrefix },
        {
          waitLockingTimeout: 1,
          defaultRetryInterval: 10,
          maximumRetryInterval: 50,
          backoffFactor: 2,
        }
      );
      providers.push({ provider, client });
      return { provider, client };
    },
  };

  let failure;
  try {
    await test(context);
  } catch (error) {
    failure = error;
  } finally {
    for (const entry of providers) {
      if (entry.client.status === "end") continue;
      try {
        if (typeof entry.provider.shutdown === "function") {
          await entry.provider.shutdown();
        } else {
          entry.client.disconnect();
        }
      } catch {
        entry.client.disconnect();
      }
    }
    for (const client of clients) {
      if (client.status !== "end") client.disconnect();
    }
    await cleanupPrefix(prefix);
  }

  checks.push({ name, ok: !failure, error: failure?.message });
  if (failure) {
    console.error("FAIL " + name + ": " + failure.message);
  } else {
    console.log("PASS " + name);
  }
}

await check("basic acquire and owner-checked release", async ({ prefix, openProvider }) => {
  const { provider, client } = await openProvider();
  await provider.acquire("basic", { ownerId: "owner-basic", expire: 20 });
  assert.equal(await client.get(prefix + "basic"), "owner-basic");
  assert.equal(await provider.release("basic", { ownerId: "owner-basic" }), true);
  assert.equal(await client.get(prefix + "basic"), null);
});

await check("failed multi-key acquire rolls back keys already acquired", async ({ prefix, openProvider }) => {
  const { provider, client } = await openProvider();
  await provider.acquire("reserved", { ownerId: "owner-reserved", expire: 20 });
  let rejected = false;
  try {
    await provider.acquire(["free", "reserved"], { ownerId: "owner-partial", expire: 20 });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, "The contender should fail on the key reserved by another owner.");
  await sleep(30);
  assert.equal(
    await client.get(prefix + "free"),
    null,
    "Partial acquisition leaked the free key after the second key failed."
  );
});

await check("same-owner re-entry succeeds with awaitQueue", async ({ openProvider }) => {
  const { provider } = await openProvider();
  await provider.acquire("reentrant", { ownerId: "owner-reentry", expire: 20 });
  const pending = provider.acquire("reentrant", {
    ownerId: "owner-reentry",
    expire: 20,
    awaitQueue: true,
  });
  pending.catch(() => {});
  const outcome = await settleWithin(pending, 900);
  assert.equal(
    outcome.kind,
    "resolved",
    "Re-entering a lock already held by the same owner did not resolve (" + outcome.kind + ")."
  );
});

await check("opposite-order multi-key acquires do not deadlock", async ({ openProvider }) => {
  const prefix = makePrefix("abba-shared");
  const first = await openProvider(prefix);
  const second = await openProvider(prefix);

  function delaySecondAcquire(client) {
    const original = client.acquireLock.bind(client);
    let calls = 0;
    client.acquireLock = async (...args) => {
      calls += 1;
      if (calls === 2) await sleep(150);
      return original(...args);
    };
  }

  delaySecondAcquire(first.client);
  delaySecondAcquire(second.client);

  async function acquireAndRelease(provider, keys, ownerId) {
    await provider.acquire(keys, { ownerId, expire: 20, awaitQueue: true });
    await provider.release(keys, { ownerId });
  }

  const concurrent = Promise.all([
    acquireAndRelease(first.provider, ["key-a", "key-b"], "owner-abba-a"),
    acquireAndRelease(second.provider, ["key-b", "key-a"], "owner-abba-b"),
  ]);
  concurrent.catch(() => {});
  const outcome = await settleWithin(concurrent, 2500);
  assert.equal(
    outcome.kind,
    "resolved",
    "Concurrent reverse-order multi-key acquisition did not finish (" + outcome.kind + ")."
  );
});

await check("releaseAll preserves a replacement lock acquired between read and delete", async ({ prefix, openProvider, openClient }) => {
  const { provider, client } = await openProvider();
  const competitor = await openClient();
  const key = prefix + "release-race";
  await provider.acquire("release-race", { ownerId: "owner-original", expire: 20 });

  const originalPipeline = client.pipeline.bind(client);
  let injected = false;
  client.pipeline = (...args) => {
    const pipeline = originalPipeline(...args);
    const originalExec = pipeline.exec.bind(pipeline);
    pipeline.exec = async (...execArgs) => {
      const result = await originalExec(...execArgs);
      if (!injected) {
        injected = true;
        await competitor.set(key, "owner-replacement", "EX", 20);
      }
      return result;
    };
    return pipeline;
  };

  await provider.releaseAll({ ownerId: "owner-original" });
  assert.equal(injected, true, "The race injection did not run.");
  assert.equal(
    await competitor.get(key),
    "owner-replacement",
    "releaseAll deleted a new lock owned by someone else after reading the previous owner."
  );
});

await check("releaseAll does not remove a different owner's lock in the non-racing case", async ({ prefix, openProvider }) => {
  const { provider, client } = await openProvider();
  await provider.acquire("mine", { ownerId: "owner-a", expire: 20 });
  await provider.acquire("theirs", { ownerId: "owner-b", expire: 20 });
  await provider.releaseAll({ ownerId: "owner-a" });
  assert.equal(await client.get(prefix + "mine"), null);
  assert.equal(await client.get(prefix + "theirs"), "owner-b");
});

await check("provider shutdown closes its Redis client", async ({ openProvider }) => {
  const { provider, client } = await openProvider();
  await provider.acquire("shutdown", { ownerId: "owner-shutdown", expire: 20 });
  await provider.shutdown();
  assert.equal(client.status, "end", "Redis client remained active after provider.shutdown().");
});

const failed = checks.filter((item) => !item.ok);
console.log("");
console.log("Redis locking checks: " + (checks.length - failed.length) + "/" + checks.length + " passed.");
if (failed.length) {
  console.error("Blocking Redis locking regression failures:");
  for (const item of failed) {
    console.error("- " + item.name + ": " + item.error);
  }
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { SafeRedisLockingProvider } from "../src/modules/locking-redis/index.mjs";

const require = createRequire(import.meta.url);
const redisModule = require("ioredis");
const Redis = redisModule.default ?? redisModule;
const redisUrl = process.env.LOCKING_REDIS_URL || process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("LOCKING_REDIS_URL or REDIS_URL must point to a disposable Redis instance.");
}

const prefix = "phase1-edge:" + randomUUID() + ":";
const redisOptions = {
  lazyConnect: true,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
};
const clients = [];
const providers = [];
const results = [];

async function openProvider(providerPrefix = prefix) {
  const client = new Redis(redisUrl, redisOptions);
  client.on("error", () => {});
  clients.push(client);
  await client.connect();
  const provider = new SafeRedisLockingProvider(
    { redisClient: client, prefix: providerPrefix },
    {
      waitLockingTimeout: 1,
      defaultRetryInterval: 10,
      maximumRetryInterval: 50,
      backoffFactor: 2,
    }
  );
  providers.push({ provider, client });
  return { provider, client };
}

async function check(name, test) {
  try {
  await check("empty lock key sets fail before issuing an unscoped Redis command", async () => {
    const { provider, client } = await openProvider();
    await assert.rejects(provider.acquire([], { ownerId: "owner-empty-set", expire: 10 }), /nonempty lock key/);
    await assert.rejects(provider.acquire([""], { ownerId: "owner-empty-key", expire: 10 }), /nonempty lock key/);
    await assert.rejects(provider.acquire(["valid", "  "], { ownerId: "owner-blank-key", expire: 10 }), /nonempty lock key/);
    assert.equal(await client.get(""), null, "Invalid input must not create a global empty Redis key.");
    assert.equal(await client.get(prefix + "undefined"), null, "Invalid input must not create a prefixed fallback key.");
  });

    await test();
    results.push({ name, ok: true });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, ok: false, error: error?.message ?? String(error) });
    console.error("FAIL " + name + ": " + (error?.message ?? String(error)));
  }
}

async function cleanup() {
  const cleanupClient = new Redis(redisUrl, redisOptions);
  cleanupClient.on("error", () => {});
  try {
    await cleanupClient.connect();
    let cursor = "0";
    do {
      const [next, keys] = await cleanupClient.scan(cursor, "MATCH", prefix + "*", "COUNT", 100);
      cursor = next;
      if (keys.length) await cleanupClient.del(...keys);
    } while (cursor !== "0");
  } finally {
    cleanupClient.disconnect();
  }
}

try {
  await check("release of a missing key returns false and is harmless", async () => {
    const { provider, client } = await openProvider();
    assert.equal(await provider.release("missing", { ownerId: "owner-missing" }), false);
    assert.equal(await client.get(prefix + "missing"), null);
  });

  await check("conflicting owner cannot acquire or release another owner's key", async () => {
    const { provider, client } = await openProvider();
    await provider.acquire("conflict", { ownerId: "owner-a", expire: 10 });
    await assert.rejects(
      provider.acquire("conflict", { ownerId: "owner-b", expire: 10, awaitQueue: false }),
      /Failed to acquire lock/
    );
    assert.equal(await provider.release("conflict", { ownerId: "owner-b" }), false);
    assert.equal(await client.get(prefix + "conflict"), "owner-a");
  });

  await check("awaitQueue waits for release even when ownerId matches", async () => {
    const first = await openProvider();
    const second = await openProvider();
    await first.provider.acquire("queue-same-owner", { ownerId: "owner-queue", expire: 10 });

    let settled = false;
    const waiting = second.provider.acquire("queue-same-owner", {
      ownerId: "owner-queue",
      expire: 10,
      awaitQueue: true,
    }).then(() => { settled = true; });
    waiting.catch(() => {});

    await sleep(80);
    assert.equal(settled, false, "awaitQueue=true must wait rather than re-enter the existing lock.");
    assert.equal(await first.provider.release("queue-same-owner", { ownerId: "owner-queue" }), true);
    await Promise.race([
      waiting,
      sleep(1000).then(() => { throw new Error("Queued acquire did not complete after release."); }),
    ]);
    assert.equal(settled, true);
    assert.equal(await second.provider.release("queue-same-owner", { ownerId: "owner-queue" }), true);
  });

  await check("expired lease disappears and can be acquired by another owner", async () => {
    const { provider, client } = await openProvider();
    await provider.acquire("ttl-expiry", { ownerId: "owner-before-expiry", expire: 1 });
    assert.equal(await client.get(prefix + "ttl-expiry"), "owner-before-expiry");
    await sleep(1150);
    assert.equal(await client.get(prefix + "ttl-expiry"), null, "Redis TTL did not expire the lock.");
    await provider.acquire("ttl-expiry", { ownerId: "owner-after-expiry", expire: 5 });
    assert.equal(await client.get(prefix + "ttl-expiry"), "owner-after-expiry");
  });

  await check("releaseAll on an empty namespace is safe", async () => {
    const emptyPrefix = prefix + "empty:";
    const { provider, client } = await openProvider(emptyPrefix);
    await provider.releaseAll({ ownerId: "owner-empty" });
    assert.equal(await client.scan("0", "MATCH", emptyPrefix + "*", "COUNT", 100).then((r) => r[1].length), 0);
  });
} finally {
  for (const { provider, client } of providers) {
    try {
      if (typeof provider.shutdown === "function") await provider.shutdown();
      else client.disconnect();
    } catch {
      client.disconnect();
    }
  }
  for (const client of clients) if (client.status !== "end") client.disconnect();
  await cleanup().catch((error) => console.error("[cleanup warning] " + error.message));
}

const failed = results.filter((result) => !result.ok);
console.log("");
console.log("Redis locking edge checks: " + (results.length - failed.length) + "/" + results.length + " passed.");
if (failed.length) process.exitCode = 1;

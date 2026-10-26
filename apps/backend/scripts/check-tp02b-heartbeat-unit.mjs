import path from "node:path";
import {
  backendRoot,
  registerTsNode,
} from "./shared/tp-harness.mjs";

const rootRequire = registerTsNode();
const {
  CheckoutLockHeartbeat,
  CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS,
  CHECKOUT_LOCK_TTL_SECONDS,
  createPostgresLeaseHeartbeatWriter,
} = rootRequire(path.join(backendRoot, "src", "workflows", "checkout-lock-heartbeat.ts"));

console.log("=== Running CheckoutLockHeartbeat Unit & Invariant Test Suite ===");

let passedCount = 0;
let totalCount = 0;

function assert(description, condition, actual) {
  totalCount += 1;
  if (condition) {
    passedCount += 1;
    console.log(`[PASS] ${description}`);
  } else {
    console.error(`[FAIL] ${description} | actual: ${JSON.stringify(actual)}`);
  }
}

// Test 1: Successful tick extends Redis lock and updates PostgreSQL lease
{
  let redisExtended = false;
  let postgresUpdated = false;
  const abortController = new AbortController();

  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      ttlSeconds: 120,
    },
    {
      extendLock: async (key, ownerId, ttl) => {
        if (key === "medusa_lock:cart:123" && ownerId === "worker:test:1" && ttl === 120) {
          redisExtended = true;
          return 1;
        }
        return 0;
      },
      leaseWriter: {
        updateHeartbeat: async ({ key, leaseOwnerId }) => {
          if (key === "11111111-1111-4111-8111-111111111111" && leaseOwnerId === "worker:test:1") {
            postgresUpdated = true;
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        },
      },
      abortController,
    }
  );

  const outcome = await heartbeat.tick();
  assert("successful tick returns renewed status with 1 rowCount", outcome.status === "renewed" && outcome.heartbeatUpdatedRows === 1, outcome);
  assert("successful tick called Redis extendLock", redisExtended === true, redisExtended);
  assert("successful tick called PostgreSQL lease update", postgresUpdated === true, postgresUpdated);
  assert("abortController was not tripped on success", abortController.signal.aborted === false, abortController.signal.aborted);
}

// Test 2: Redis lock lost (extendLock returns 0) aborts immediately and refuses to update PostgreSQL
{
  let redisCalled = false;
  let postgresCalled = false;
  const abortController = new AbortController();

  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    },
    {
      extendLock: async () => {
        redisCalled = true;
        return 0; // Lock expired or acquired by another worker
      },
      leaseWriter: {
        updateHeartbeat: async () => {
          postgresCalled = true;
          return { rowCount: 1 };
        },
      },
      abortController,
    }
  );

  const outcome = await heartbeat.tick();
  assert("lost lock returns lock_lost with reason LOCK_LOST", outcome.status === "lock_lost" && outcome.reason === "LOCK_LOST", outcome);
  assert("Redis extendLock was called", redisCalled === true, redisCalled);
  assert("PostgreSQL lease update was NEVER called when Redis lost", postgresCalled === false, postgresCalled);
  assert("abortController was tripped with reason LOCK_LOST", abortController.signal.aborted === true && abortController.signal.reason === "LOCK_LOST", abortController.signal.reason);

  // Subsequent tick after aborted state returns stopped immediately
  const subsequentOutcome = await heartbeat.tick();
  assert("tick after aborted state returns stopped without re-running", subsequentOutcome.status === "stopped", subsequentOutcome);
}

// Test 3: Redis transport/network error aborts with REDIS_ERROR and refuses to update PostgreSQL
{
  let postgresCalled = false;
  const abortController = new AbortController();

  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    },
    {
      extendLock: async () => {
        throw new Error("Connection reset by peer");
      },
      leaseWriter: {
        updateHeartbeat: async () => {
          postgresCalled = true;
          return { rowCount: 1 };
        },
      },
      abortController,
    }
  );

  const outcome = await heartbeat.tick();
  assert("redis exception returns lock_lost with reason REDIS_ERROR", outcome.status === "lock_lost" && outcome.reason === "REDIS_ERROR", outcome);
  assert("PostgreSQL lease update was NEVER called when Redis errored", postgresCalled === false, postgresCalled);
  assert("abortController was tripped with reason REDIS_ERROR", abortController.signal.aborted === true && abortController.signal.reason === "REDIS_ERROR", abortController.signal.reason);
}

// Test 4: PostgreSQL lease lost (rowCount 0) aborts with LEASE_NOT_PENDING
{
  let redisCalled = false;
  const abortController = new AbortController();

  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    },
    {
      extendLock: async () => {
        redisCalled = true;
        return 1;
      },
      leaseWriter: {
        updateHeartbeat: async () => {
          return { rowCount: 0 }; // Lease was taken over or status is not pending
        },
      },
      abortController,
    }
  );

  const outcome = await heartbeat.tick();
  assert("lease lost returns lock_lost with reason LEASE_NOT_PENDING", outcome.status === "lock_lost" && outcome.reason === "LEASE_NOT_PENDING", outcome);
  assert("abortController was tripped with reason LEASE_NOT_PENDING", abortController.signal.aborted === true && abortController.signal.reason === "LEASE_NOT_PENDING", abortController.signal.reason);
}

// Test 5: Timer scheduling and cancellation
{
  let scheduledInterval = 0;
  let timerCleared = false;
  let callbackInvoked = false;

  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    },
    {
      extendLock: async () => {
        callbackInvoked = true;
        return 1;
      },
      leaseWriter: {
        updateHeartbeat: async () => ({ rowCount: 1 }),
      },
      setIntervalFn: ((fn, ms) => {
        scheduledInterval = ms;
        // simulate a tick
        void fn();
        return 999;
      }),
      clearIntervalFn: ((timerId) => {
        if (timerId === 999) timerCleared = true;
      }),
    }
  );

  heartbeat.start();
  assert("start schedules exact 30s interval", scheduledInterval === CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS, scheduledInterval);
  assert("timer callback ran tick", callbackInvoked === true, callbackInvoked);

  await heartbeat.stop();
  assert("stop clears the timer", timerCleared === true, timerCleared);
}

// Test 6: Stop waits for an in-flight renewal before returning
{
  let resolveExtend;
  let leaseUpdateCount = 0;
  let timerCleared = false;
  const extendPromise = new Promise((resolve) => { resolveExtend = resolve; });
  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    },
    {
      extendLock: async () => {
        await extendPromise;
        return 1;
      },
      leaseWriter: {
        updateHeartbeat: async () => {
          leaseUpdateCount += 1;
          return { rowCount: 1 };
        },
      },
      setIntervalFn: (() => 999),
      clearIntervalFn: ((timerId) => {
        if (timerId === 999) timerCleared = true;
      }),
    }
  );

  heartbeat.start();
  const tick = heartbeat.tick();
  let stopSettled = false;
  const stop = heartbeat.stop().then(() => { stopSettled = true; });
  await Promise.resolve();
  assert("stop remains pending while renewal is in flight", stopSettled === false, stopSettled);
  assert("stop clears the scheduled timer immediately", timerCleared === true, timerCleared);

  resolveExtend();
  const outcome = await tick;
  await stop;
  assert("in-flight renewal completes before stop resolves", outcome.status === "renewed" && leaseUpdateCount === 1, { outcome, leaseUpdateCount });
  assert("ticks after stop do not start another renewal", (await heartbeat.tick()).status === "stopped", leaseUpdateCount);
}

// Test 7: In-flight tick deduplication
{
  let extendCount = 0;
  let resolveExtend;
  const extendPromise = new Promise((resolve) => { resolveExtend = resolve; });

  const heartbeat = new CheckoutLockHeartbeat(
    {
      lockKey: "medusa_lock:cart:123",
      ownerId: "worker:test:1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    },
    {
      extendLock: async () => {
        extendCount += 1;
        await extendPromise;
        return 1;
      },
      leaseWriter: {
        updateHeartbeat: async () => ({ rowCount: 1 }),
      },
    }
  );

  const tick1 = heartbeat.tick();
  const tick2 = heartbeat.tick(); // Should reuse tick1
  resolveExtend();

  const [res1, res2] = await Promise.all([tick1, tick2]);
  assert("concurrent ticks share the same execution", extendCount === 1, extendCount);
  assert("both ticks receive renewed outcome", res1.status === "renewed" && res2.status === "renewed", { res1, res2 });
}

// Test 8: Postgres lease writer SQL formatting
{
  let executedSql = "";
  let executedValues = [];

  const mockPgClient = {
    query: async (text, values) => {
      executedSql = text;
      executedValues = values;
      return { rowCount: 1 };
    },
  };

  const writer = createPostgresLeaseHeartbeatWriter(mockPgClient);
  const result = await writer.updateHeartbeat({
    key: "my-key",
    leaseOwnerId: "my-worker",
  });

  assert("createPostgresLeaseHeartbeatWriter returns rowCount", result.rowCount === 1, result);
  assert("query checks key and lease_owner_id and status='pending'",
    executedSql.includes("WHERE key = $1") &&
    executedSql.includes("lease_owner_id = $2") &&
    executedSql.includes("status = 'pending'"),
    executedSql
  );
  assert("query parameters match key and ownerId", executedValues[0] === "my-key" && executedValues[1] === "my-worker", executedValues);
}

console.log("");
console.log(`CheckoutLockHeartbeat Unit Test Summary: ${passedCount}/${totalCount} passed.`);
if (passedCount !== totalCount) {
  process.exit(1);
}

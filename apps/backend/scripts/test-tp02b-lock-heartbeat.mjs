import { randomUUID } from "node:crypto"
import path from "node:path"
import {
  backendRoot,
  repositoryRoot,
  registerTsNode,
  formatSqlTable,
  getSystemMetadata,
  loadMedusaContainer,
  createPgClient,
  createRedisClient,
  cleanupRedisLockKey,
  safeCloseClients,
  writeTpEvidence,
  verifyDisposableTargetServices,
  runDisposableValidatorSelfChecks,
} from "./shared/tp-harness.mjs"

const rootRequire = registerTsNode()
const { Modules } = rootRequire("@medusajs/framework/utils")
const {
  CheckoutLockHeartbeat,
  CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS,
  createPostgresLeaseHeartbeatWriter,
} = rootRequire(path.join(backendRoot, "src", "workflows", "checkout-lock-heartbeat.ts"))

const evidenceDir = path.join(repositoryRoot, "artifacts", "tp-evidence", "TP-02b")
const startedAt = new Date().toISOString()
const metadata = await getSystemMetadata()
const databaseUrl = process.env.DATABASE_URL
const redisUrl = process.env.LOCKING_REDIS_URL || process.env.REDIS_URL
const logLines = []
const errLines = []
const assertions = []

let pgClient = null
let redisClient = null
let failureRedisClient = null
let lockingService = null
let batchInventoryService = null
let cartService = null
let createdCartId = null
let createdSessionCartId = null
let primaryIdempotencyKey = null
let failureIdempotencyKey = null
let prefixedRedisLockKey = null
let lockOwnerId = null
let dbBefore = null
let dbAfter = null
let dbQueries = null
let containerDetails = null
let cleanupErrors = []
let activeHeartbeat = null
const interleaving = []

const log = (message) => {
  console.log(message)
  logLines.push(message)
}
const logErr = (message) => {
  console.error(message)
  errLines.push(message)
}
const assert = (name, expected, actual, passed, detail, category = "behavioral") => {
  assertions.push({ name, expected, actual, passed: Boolean(passed), detail, category })
  log(`${passed ? "PASS" : "FAIL"} [${name}]: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`)
}

async function writeEvidence(status, exitCode, blocker = null) {
  await writeTpEvidence({
    evidenceDir,
    tpId: "TP-02b",
    title: "Redis Lock Renewal & Heartbeat Coordination",
    batch: "B",
    status,
    assessmentType: "behavioral test (worker-component boundary; no HTTP checkout route)",
    startedAt,
    commitSha: metadata.commitSha,
    nodeVersion: metadata.nodeVersion,
    npmVersion: metadata.npmVersion,
    packageLockSha256: metadata.packageLockSha256,
    testCommand: "node apps/backend/scripts/test-tp02b-lock-heartbeat.mjs",
    exitCode,
    blocker,
    assertions,
    dbBefore,
    dbAfter,
    dbQueries,
    containerDetails,
    interleaving,
    note: status === "passed"
      ? "TP-02b exercised a real Medusa container, configured locking provider, PostgreSQL idempotency_key table, and Redis extendLock Lua command. It verifies the worker component boundary only; no HTTP checkout route exists. Await independent review."
      : "TP-02b execution blocked by missing prerequisites, safety refusal, environment failure, or a failed assertion.",
    logLines,
    errLines,
  })
}

async function snapshotLease(key) {
  const result = await pgClient.query(
    `SELECT key, request_path, request_hash, status, lease_owner_id,
            locked_at, last_heartbeat_at, expires_at, created_at, updated_at, deleted_at
     FROM idempotency_key WHERE key = $1`,
    [key]
  )
  return result.rows[0] || null
}

async function createLeaseFixture({ key, ownerId }) {
  await pgClient.query(
    `INSERT INTO idempotency_key (
       key, request_path, request_hash, status, lease_owner_id,
       locked_at, last_heartbeat_at, expires_at
     ) VALUES ($1, $2, $3, 'pending', $4, NOW(), NOW(), NOW() + INTERVAL '14 days')`,
    [key, "/store/carts/test/complete", "a".repeat(64), ownerId]
  )
  return snapshotLease(key)
}

async function cleanup() {
  try {
    if (activeHeartbeat) await activeHeartbeat.stop()
    if (lockingService && createdCartId && lockOwnerId) {
      try {
        await lockingService.release("cart:" + createdCartId, { ownerId: lockOwnerId })
      } catch (error) {
        const message = "Medusa locking release: " + error.message
        cleanupErrors.push(message)
        logErr("Cleanup error: " + message)
      }
    }

    if (redisClient && prefixedRedisLockKey && lockOwnerId) {
      await cleanupRedisLockKey(redisClient, prefixedRedisLockKey, lockOwnerId, {
        log,
        logErr,
        cleanupErrors,
      })
    }

    if (pgClient) {
      for (const key of [primaryIdempotencyKey, failureIdempotencyKey].filter(Boolean)) {
        try {
          await pgClient.query("DELETE FROM idempotency_key WHERE key = $1", [key])
        } catch (error) {
          const message = `idempotency_key ${key}: ${error.message}`
          cleanupErrors.push(message)
          logErr("Cleanup error: " + message)
        }
      }
      if (createdSessionCartId) {
        try {
          await pgClient.query("DELETE FROM cart_checkout_session WHERE cart_id = $1", [createdSessionCartId])
        } catch (error) {
          const message = `cart_checkout_session ${createdSessionCartId}: ${error.message}`
          cleanupErrors.push(message)
          logErr("Cleanup error: " + message)
        }
      }
    }

    if (cartService && createdCartId) {
      try {
        await cartService.deleteCarts(createdCartId)
      } catch (error) {
        const message = `Medusa Cart ${createdCartId}: ${error.message}`
        cleanupErrors.push(message)
        logErr("Cleanup error: " + message)
      }
    }
  } finally {
    await safeCloseClients({
      pgClient,
      redisClient,
      log,
      logErr,
      cleanupErrors,
    })
    if (failureRedisClient) {
      await safeCloseClients({
        redisClient: failureRedisClient,
        log,
        logErr,
        cleanupErrors,
      })
    }
  }
}

async function executeTp02b() {
  log("=== Starting TP-02b: Redis Lock Renewal & Heartbeat Coordination ===")
  log(`Time: ${startedAt} | Commit: ${metadata.commitSha} | Node: ${metadata.nodeVersion}`)

  if (!databaseUrl || !redisUrl) {
    const blocker = "DATABASE_URL or LOCKING_REDIS_URL / REDIS_URL is missing. Disposable services are required."
    assert("disposable_services_configured", true, false, false, blocker, "safety")
    return { status: "blocked", exitCode: 1, blocker }
  }

  let disposableTarget
  try {
    disposableTarget = verifyDisposableTargetServices(databaseUrl, redisUrl)
    assert("disposable_target_verified", true, true, true, JSON.stringify(disposableTarget), "safety")
  } catch (error) {
    const blocker = "Target service safety validation failed: " + error.message
    assert("disposable_target_verified", true, false, false, blocker, "safety")
    return { status: "blocked", exitCode: 1, blocker }
  }

  const validatorChecks = runDisposableValidatorSelfChecks()
  assert(
    "disposable_target_validator_self_checks",
    "all checks pass",
    `${validatorChecks.passed}/${validatorChecks.total}`,
    validatorChecks.allPassed,
    "Self-checks execute before test connections.",
    "safety"
  )
  if (!validatorChecks.allPassed) {
    return { status: "blocked", exitCode: 1, blocker: "Disposable target validator self-check failed." }
  }

  try {
    pgClient = createPgClient(databaseUrl)
    redisClient = createRedisClient(redisUrl)
    await pgClient.connect()
    await redisClient.connect()

    const requiredTables = await pgClient.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('cart', 'cart_checkout_session', 'idempotency_key')
       ORDER BY table_name`
    )
    const presentTables = requiredTables.rows.map((row) => row.table_name)
    const requiredPresent = ["cart", "cart_checkout_session", "idempotency_key"].every((table) => presentTables.includes(table))
    assert(
      "required_schema_tables_present",
      ["cart", "cart_checkout_session", "idempotency_key"],
      presentTables,
      requiredPresent,
      "TP-02b requires baseline Medusa cart and migration-backed lease/session tables.",
      "schema"
    )
    if (!requiredPresent) {
      return { status: "blocked", exitCode: 1, blocker: "Required TP-02b tables are missing after migrations." }
    }

    log("Loading real Medusa container from medusa-config.ts...")
    const container = await loadMedusaContainer()
    lockingService = container.resolve(Modules.LOCKING)
    batchInventoryService = container.resolve("batch_inventory")
    const systemSecurityService = container.resolve("system_security")
    cartService = container.resolve(Modules.CART)
    const providerId = lockingService?.defaultProviderId
    const provider = lockingService?.providerService_?.retrieveProviderRegistration(providerId)
    const providerClient = provider?.redisClient
    const providerPrefix = provider?.keyNamePrefix ?? provider?.prefix ?? "medusa_lock:"

    containerDetails = {
      medusaConfigFile: "apps/backend/medusa-config.ts",
      lockingModuleResolved: Boolean(lockingService),
      lockingProviderId: providerId || null,
      lockingProviderClass: provider?.constructor?.name || null,
      lockingProviderPrefix: providerPrefix || null,
      lockingProviderSupportsExtendLock: typeof providerClient?.extendLock === "function",
      batchInventoryModuleResolved: Boolean(batchInventoryService),
      systemSecurityModuleResolved: Boolean(systemSecurityService),
      cartModuleResolved: Boolean(cartService),
    }
    log("Container details: " + JSON.stringify(containerDetails))

    const containerReady = Boolean(
      lockingService && batchInventoryService && systemSecurityService && cartService &&
      providerPrefix && typeof providerClient?.extendLock === "function"
    )
    assert(
      "real_medusa_container_and_required_modules_resolved",
      true,
      containerDetails,
      containerReady,
      "The runner uses the configured Medusa container and its active Redis locking provider."
    )
    if (!containerReady) {
      return { status: "blocked", exitCode: 1, blocker: "Medusa container did not expose required modules or extendLock." }
    }

    const cart = await cartService.createCarts({
      currency_code: "usd",
      metadata: { test_fixture: "TP-02b", created_at: new Date().toISOString() },
    })
    createdCartId = cart.id
    const attemptId = randomUUID()
    lockOwnerId = "worker:tp02b:" + randomUUID()
    primaryIdempotencyKey = randomUUID()
    failureIdempotencyKey = randomUUID()
    createdSessionCartId = createdCartId

    await batchInventoryService.createCartCheckoutSessions({
      cart_id: createdCartId,
      current_attempt_id: attemptId,
      epoch: 1,
      status: "in_progress",
    })
    const cartPersisted = await pgClient.query("SELECT id FROM cart WHERE id = $1", [createdCartId])
    const sessionPersisted = await pgClient.query(
      "SELECT cart_id, current_attempt_id, epoch, status FROM cart_checkout_session WHERE cart_id = $1",
      [createdCartId]
    )
    assert(
      "real_cart_and_checkout_session_fixture_persisted",
      { cartRows: 1, sessionRows: 1, status: "in_progress" },
      { cartRows: cartPersisted.rowCount, sessionRows: sessionPersisted.rowCount, status: sessionPersisted.rows[0]?.status },
      cartPersisted.rowCount === 1 && sessionPersisted.rowCount === 1 && sessionPersisted.rows[0]?.status === "in_progress",
      "The active worker fixture is backed by real Medusa Cart and batch_inventory session records."
    )

    const leaseBefore = await createLeaseFixture({ key: primaryIdempotencyKey, ownerId: lockOwnerId })
    const failureLeaseBefore = await createLeaseFixture({ key: failureIdempotencyKey, ownerId: lockOwnerId })
    assert(
      "pending_idempotency_leases_persisted",
      2,
      leaseBefore && failureLeaseBefore ? 2 : 0,
      Boolean(leaseBefore && failureLeaseBefore),
      "Both success and real Redis-client failure branches begin with pending database leases.",
      "schema"
    )

    const lockKey = "cart:" + createdCartId
    prefixedRedisLockKey = providerPrefix + lockKey
    await lockingService.acquire(lockKey, { ownerId: lockOwnerId, expire: 120 })
    const lockBefore = await redisClient.get(prefixedRedisLockKey)
    const ttlBefore = await redisClient.ttl(prefixedRedisLockKey)
    assert(
      "real_redis_lock_owned_before_heartbeat",
      { owner: lockOwnerId, positiveTtl: true },
      { owner: lockBefore, ttl: ttlBefore },
      lockBefore === lockOwnerId && ttlBefore > 0,
      "The configured Medusa provider acquired the physical Redis lock before renewal."
    )

    let scheduled = null
    let clearCount = 0
    let releaseRenewal
    let renewalEntered
    const renewalGate = new Promise((resolve) => { releaseRenewal = resolve })
    const renewalStarted = new Promise((resolve) => { renewalEntered = resolve })
    const record = (event) => interleaving.push({ event, at: new Date().toISOString() })
    const leaseWriter = createPostgresLeaseHeartbeatWriter(pgClient)
    const heartbeat = new CheckoutLockHeartbeat(
      {
        lockKey: prefixedRedisLockKey,
        ownerId: lockOwnerId,
        idempotencyKey: primaryIdempotencyKey,
        ttlSeconds: 120,
      },
      {
        extendLock: async (key, ownerId, ttlSeconds) => {
          record("renewal_waiting_at_gate")
          renewalEntered()
          await renewalGate
          const result = await providerClient.extendLock(key, ownerId, ttlSeconds)
          record("real_redis_renewal_completed")
          return result
        },
        leaseWriter: { updateHeartbeat: async (input) => {
          const result = await leaseWriter.updateHeartbeat(input)
          record("real_postgres_heartbeat_completed")
          return result
        } },
        setIntervalFn: (callback, intervalMs) => {
          scheduled = { callback, intervalMs }
          return { testTimer: true }
        },
        clearIntervalFn: () => { clearCount += 1 },
      }
    )
    activeHeartbeat = heartbeat
    heartbeat.start()
    assert(
      "heartbeat_schedules_exact_30_second_interval",
      CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS,
      scheduled?.intervalMs ?? null,
      scheduled?.intervalMs === CHECKOUT_LOCK_HEARTBEAT_INTERVAL_MS,
      "The scheduler is controlled deterministically; the renewal and database work remain real services."
    )

    dbBefore = {
      cart: cartPersisted.rows,
      session: sessionPersisted.rows,
      leaseBefore,
      failureLeaseBefore,
      redis: { key: prefixedRedisLockKey, owner: lockBefore, ttl: ttlBefore },
    }
    dbQueries = {
      before: `SELECT * FROM idempotency_key WHERE key IN ('${primaryIdempotencyKey}', '${failureIdempotencyKey}');\nSELECT * FROM cart_checkout_session WHERE cart_id = '${createdCartId}';\n`,
      after: `SELECT * FROM idempotency_key WHERE key IN ('${primaryIdempotencyKey}', '${failureIdempotencyKey}');\nSELECT * FROM cart_checkout_session WHERE cart_id = '${createdCartId}';\n`,
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
    // The timer callback deliberately returns void. Join its in-flight tick;
    // awaiting the callback itself would race the real Redis/SQL operations.
    scheduled.callback()
    const pendingTick = heartbeat.tick()
    await renewalStarted
    let stopSettled = false
    const stopPromise = heartbeat.stop().then(() => {
      stopSettled = true
      record("stop_completed")
    })
    try {
      const leaseDuringDelay = await snapshotLease(primaryIdempotencyKey)
      const ownerDuringDelay = await redisClient.get(prefixedRedisLockKey)
      record("database_and_redis_inspected_during_delay")
      assert(
        "delayed_redis_renewal_blocks_postgres_heartbeat_and_stop",
        { leaseUnchanged: true, stopSettled: false, owner: lockOwnerId },
        { leaseDuringDelay, stopSettled, owner: ownerDuringDelay },
        JSON.stringify(leaseDuringDelay) === JSON.stringify(leaseBefore) && !stopSettled && ownerDuringDelay === lockOwnerId,
        "A deterministic gate delays the real provider renewal; real SQL and Redis are inspected while it is pending."
      )
    } finally {
      releaseRenewal()
    }
    const successOutcome = await pendingTick
    await stopPromise
    const leaseAfterSuccess = await snapshotLease(primaryIdempotencyKey)
    const ttlAfterSuccess = await redisClient.ttl(prefixedRedisLockKey)
    const advancedHeartbeat = new Date(leaseAfterSuccess.last_heartbeat_at).getTime() > new Date(leaseBefore.last_heartbeat_at).getTime()
    assert(
      "redis_extendlock_success_updates_pending_lease_heartbeat",
      { outcome: "renewed", rowCount: 1, heartbeatAdvanced: true },
      { outcome: successOutcome, rowCount: successOutcome?.heartbeatUpdatedRows, heartbeatAdvanced: advancedHeartbeat, ttl: ttlAfterSuccess },
      successOutcome?.status === "renewed" && successOutcome?.heartbeatUpdatedRows === 1 && advancedHeartbeat && ttlAfterSuccess > 0,
      "The actual provider Redis extendLock returned 1 before the guarded PostgreSQL UPDATE ran."
    )

    await heartbeat.stop()
    await lockingService.release(lockKey, { ownerId: lockOwnerId })
    record("lock_release_completed")
    const redisAfterRelease = await redisClient.get(prefixedRedisLockKey)
    assert(
      "stop_joins_real_renewal_before_lock_release",
      ["renewal_waiting_at_gate", "database_and_redis_inspected_during_delay", "real_redis_renewal_completed", "real_postgres_heartbeat_completed", "stop_completed", "lock_release_completed"],
      interleaving.map((entry) => entry.event),
      interleaving.map((entry) => entry.event).join(",") === "renewal_waiting_at_gate,database_and_redis_inspected_during_delay,real_redis_renewal_completed,real_postgres_heartbeat_completed,stop_completed,lock_release_completed" && redisAfterRelease === null,
      "Observed worker events and the real Redis key establish lifecycle ordering."
    )
    const leaseBeforeLoss = await snapshotLease(primaryIdempotencyKey)
    const lockLossHeartbeat = new CheckoutLockHeartbeat(
      {
        lockKey: prefixedRedisLockKey,
        ownerId: lockOwnerId,
        idempotencyKey: primaryIdempotencyKey,
      },
      {
        extendLock: (key, ownerId, ttlSeconds) => providerClient.extendLock(key, ownerId, ttlSeconds),
        leaseWriter: createPostgresLeaseHeartbeatWriter(pgClient),
      }
    )
    const lostOutcome = await lockLossHeartbeat.tick()
    const leaseAfterLoss = await snapshotLease(primaryIdempotencyKey)
    const unchangedAfterLoss = new Date(leaseBeforeLoss.last_heartbeat_at).getTime() === new Date(leaseAfterLoss.last_heartbeat_at).getTime() &&
      new Date(leaseBeforeLoss.locked_at).getTime() === new Date(leaseAfterLoss.locked_at).getTime()
    assert(
      "lost_redis_lock_aborts_worker_without_postgres_heartbeat",
      { redisKeyAbsent: true, outcome: "lock_lost", reason: "LOCK_LOST", postgresUnchanged: true, aborted: true },
      { redisKeyAbsent: redisAfterRelease === null, outcome: lostOutcome, postgresUnchanged: unchangedAfterLoss, aborted: lockLossHeartbeat.abortController.signal.aborted, clearCount },
      redisAfterRelease === null && lostOutcome?.status === "lock_lost" && lostOutcome?.reason === "LOCK_LOST" && unchangedAfterLoss && lockLossHeartbeat.abortController.signal.aborted,
      "Redis returned 0 after the real provider release, so no PostgreSQL heartbeat was attempted."
    )

    failureRedisClient = createRedisClient(redisUrl)
    await failureRedisClient.connect()
    failureRedisClient.disconnect()
    const failureHeartbeat = new CheckoutLockHeartbeat(
      {
        lockKey: prefixedRedisLockKey,
        ownerId: lockOwnerId,
        idempotencyKey: failureIdempotencyKey,
      },
      {
        extendLock: (key, ownerId, ttlSeconds) => failureRedisClient.eval(
          "return redis.call('EXPIRE', KEYS[1], ARGV[2])",
          1,
          key,
          ownerId,
          ttlSeconds
        ),
        leaseWriter: createPostgresLeaseHeartbeatWriter(pgClient),
      }
    )
    const failureOutcome = await failureHeartbeat.tick()
    const failureLeaseAfter = await snapshotLease(failureIdempotencyKey)
    const unchangedAfterError = new Date(failureLeaseBefore.last_heartbeat_at).getTime() === new Date(failureLeaseAfter.last_heartbeat_at).getTime() &&
      new Date(failureLeaseBefore.locked_at).getTime() === new Date(failureLeaseAfter.locked_at).getTime()
    assert(
      "redis_connection_failure_aborts_without_postgres_heartbeat",
      { outcome: "lock_lost", reason: "REDIS_ERROR", postgresUnchanged: true, aborted: true },
      { outcome: failureOutcome, postgresUnchanged: unchangedAfterError, aborted: failureHeartbeat.abortController.signal.aborted },
      failureOutcome?.status === "lock_lost" && failureOutcome?.reason === "REDIS_ERROR" && unchangedAfterError && failureHeartbeat.abortController.signal.aborted,
      "A deliberately disconnected real Redis client caused a transport failure; the database lease was not updated."
    )

    const sessionAfter = await pgClient.query(
      "SELECT cart_id, current_attempt_id, epoch, status FROM cart_checkout_session WHERE cart_id = $1",
      [createdCartId]
    )
    dbAfter = {
      leaseAfterSuccess,
      leaseAfterLoss,
      failureLeaseAfter,
      sessionAfter: sessionAfter.rows,
      redisAfterRelease,
    }
    const sessionUnchanged = JSON.stringify(sessionPersisted.rows[0]) === JSON.stringify(sessionAfter.rows[0])
    assert(
      "heartbeat_does_not_mutate_cart_checkout_session",
      sessionPersisted.rows[0],
      sessionAfter.rows[0],
      sessionUnchanged,
      "The heartbeat renews only its idempotency lease; checkout epoch and session state are not changed."
    )

    log("Before snapshot:\n" + formatSqlTable([leaseBefore, failureLeaseBefore], ["key", "status", "lease_owner_id", "locked_at", "last_heartbeat_at"]))
    log("After snapshot:\n" + formatSqlTable([leaseAfterLoss, failureLeaseAfter], ["key", "status", "lease_owner_id", "locked_at", "last_heartbeat_at"]))
  } catch (error) {
    logErr("UNCAUGHT EXCEPTION during TP-02b: " + (error?.stack || String(error)))
    assert("uncaught_exception_free_execution", true, false, false, error?.message || String(error), "reliability")
  }

  const failed = assertions.filter((entry) => !entry.passed)
  return {
    status: failed.length === 0 ? "passed" : "failed",
    exitCode: failed.length === 0 ? 0 : 1,
    blocker: failed.length === 0 ? null : failed.map((entry) => entry.name).join(", "),
  }
}

let outcome
try {
  outcome = await executeTp02b()
} finally {
  await cleanup()
}

if (cleanupErrors.length) {
  for (const error of cleanupErrors) {
    assert("cleanup_completed_without_error", true, false, false, error, "lifecycle")
  }
  outcome = { status: "failed", exitCode: 1, blocker: "cleanup_errors" }
}

const failedAssertions = assertions.filter((entry) => !entry.passed)
if (outcome.status === "passed" && failedAssertions.length) {
  outcome = { status: "failed", exitCode: 1, blocker: failedAssertions.map((entry) => entry.name).join(", ") }
}

log(`TP-02b Assertion Summary: ${assertions.length - failedAssertions.length}/${assertions.length} passed.`)
if (outcome.status === "passed") {
  log("SUCCESS: TP-02b worker-component behavior passed. Evidence written for independent review.")
} else {
  logErr(`FAIL: TP-02b status=${outcome.status}; blocker=${outcome.blocker || "unknown"}`)
}
await writeEvidence(outcome.status, outcome.exitCode, outcome.blocker)
process.exit(outcome.exitCode)

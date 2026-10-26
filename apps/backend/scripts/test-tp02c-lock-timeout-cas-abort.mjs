import { randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
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
} from "./shared/tp-harness.mjs";

const rootRequire = registerTsNode();
const { ContainerRegistrationKeys, MedusaError, Modules } = rootRequire("@medusajs/framework/utils");
const { stage2CheckoutLockWorkflow, abortPendingLeaseOnLockTimeout } = rootRequire(
  path.join(backendRoot, "src", "workflows", "stage2-checkout-lock-workflow.ts")
);

const evidenceDir = path.join(repositoryRoot, "artifacts", "tp-evidence", "TP-02c");
const logLines = [];
const errLines = [];
const log = (msg) => { console.log(msg); logLines.push(msg); };
const logErr = (msg) => { console.error(msg); errLines.push(msg); };

const startedAt = new Date().toISOString();
const metadata = await getSystemMetadata();
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.LOCKING_REDIS_URL || process.env.REDIS_URL;

async function writeEvidence(args) {
  await writeTpEvidence({
    evidenceDir,
    tpId: "TP-02c",
    title: "Lock Timeout CAS Lease Abort",
    batch: "B",
    assessmentType: "behavioral acceptance test (workflow-level CAS lease abort; no HTTP checkout route)",
    startedAt,
    commitSha: metadata.commitSha,
    nodeVersion: metadata.nodeVersion,
    npmVersion: metadata.npmVersion,
    packageLockSha256: metadata.packageLockSha256,
    testCommand: "node apps/backend/scripts/test-tp02c-lock-timeout-cas-abort.mjs",
    note: args.status === "passed"
      ? "TP-02c executed against real Medusa container and disposable PostgreSQL/Redis. Verified lock acquisition timeout (>5s) executes guarded CAS deletion of pending idempotency lease without touching other workers or completed leases, throwing MedusaError(CONFLICT, LOCK_TIMEOUT). Await independent review."
      : "TP-02c execution blocked by missing prerequisites, safety refusal, or environment service failure.",
    logLines,
    errLines,
    ...args,
  });
}

async function runTp02cTest() {
  log("=== Starting TP-02c: Lock Timeout CAS Lease Abort (Behavioral Test) ===");
  log(`Time: ${startedAt} | Commit: ${metadata.commitSha} | Node: ${metadata.nodeVersion}`);

  if (!databaseUrl || !redisUrl) {
    const reason = "DATABASE_URL or LOCKING_REDIS_URL / REDIS_URL not configured. Disposable services required.";
    logErr("BLOCKED TP-02c: " + reason);
    await writeEvidence({
      status: "blocked",
      blocker: reason,
      assertions: [{ name: "disposable_services_configured", expected: true, actual: false, passed: false, detail: reason }],
      exitCode: 1,
    });
    return 1;
  }

  let disposableCheck;
  try {
    disposableCheck = verifyDisposableTargetServices(databaseUrl, redisUrl);
    log(`Target services verified (profile=${disposableCheck.executionProfile}): ` + JSON.stringify(disposableCheck));
  } catch (err) {
    const reason = "Target services safety check failed: " + err.message;
    logErr("BLOCKED TP-02c: " + reason);
    await writeEvidence({
      status: "blocked",
      blocker: reason,
      assertions: [{ name: "target_services_verified_disposable", expected: true, actual: false, passed: false, detail: reason }],
      exitCode: 1,
    });
    return 1;
  }

  const validatorSelfCheck = runDisposableValidatorSelfChecks();
  log(`Disposable target validator self-checks: ${validatorSelfCheck.passed}/${validatorSelfCheck.total} passed.`);

  let pgClient = null;
  let redisClient = null;
  let createdCartId = null;
  let createdRedisPrefixedKey = null;
  let workerAId = null;
  let workerBId = null;
  let workerCId = null;
  let workerBKey = null;
  let workerCKey = null;
  let workerBCompletedKey = null;
  let lockingService = null;
  let testStatus = "failed";
  let exitCode = 1;
  let blockerReason = null;
  const assertions = [];
  let dbBeforeSnapshot = null;
  let dbAfterSnapshot = null;
  let dbQueries = null;
  let containerDetails = null;
  let caughtException = null;
  const cleanupErrors = [];

  try {
    pgClient = createPgClient(databaseUrl);
    await pgClient.connect();
    redisClient = createRedisClient(redisUrl);
    await redisClient.connect();
    const redisPing = await redisClient.ping();
    log(`Connected PG client and Redis client (PING=${redisPing}).`);

    const checkTable = async (name) => {
      const res = await pgClient.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [name]
      );
      return res.rows.length > 0;
    };

    const sessionTablePresent = await checkTable("cart_checkout_session");
    const cartTablePresent = await checkTable("cart");
    const idempotencyTablePresent = await checkTable("idempotency_key");

    if (!sessionTablePresent || !cartTablePresent || !idempotencyTablePresent) {
      blockerReason = `Required tables missing: cart_checkout_session=${sessionTablePresent}, cart=${cartTablePresent}, idempotency_key=${idempotencyTablePresent}`;
      logErr("BLOCKED TP-02c: " + blockerReason);
      testStatus = "blocked";
    } else {
      log("Loading REAL Medusa container from " + backendRoot + "...");
      const container = await loadMedusaContainer();
      log("REAL Medusa container initialized successfully.");

      lockingService = container.resolve(Modules.LOCKING);
      const batchInventoryService = container.resolve("batch_inventory");
      const systemSecurityService = container.resolve("system_security");
      const cartService = container.resolve(Modules.CART);
      const providerId = lockingService?.defaultProviderId;
      const providerInstance = lockingService?.providerService_?.retrieveProviderRegistration(providerId);
      const providerPrefix = providerInstance?.keyNamePrefix ?? providerInstance?.prefix ?? "medusa_lock:";

      containerDetails = {
        lockingProviderId: providerId,
        lockingKeyPrefix: providerPrefix,
        lockingModuleResolved: Boolean(lockingService),
        batchInventoryModuleResolved: Boolean(batchInventoryService),
        systemSecurityModuleResolved: Boolean(systemSecurityService),
        cartModuleResolved: Boolean(cartService),
      };

      // 1. Create real Medusa Cart fixture
      const realCart = await cartService.createCarts({
        currency_code: "egp",
        items: [],
        metadata: { tp: "TP-02c", purpose: "Lock timeout CAS lease abort" },
      });
      const cartId = realCart.id;
      createdCartId = cartId;
      log(`Created real Medusa Cart fixture: ${cartId}`);

      // 2. Establish Cart Checkout Session
      await batchInventoryService.createCartCheckoutSessions({
        cart_id: cartId,
        current_attempt_id: randomUUID(),
        epoch: 1,
        status: "in_progress",
      });

      // 3. Worker A acquires cart lock in Redis (ttl=120s)
      const lockKey = "cart:" + cartId;
      createdRedisPrefixedKey = providerPrefix + lockKey;
      workerAId = "worker:tp02c:A:" + randomUUID();
      workerBId = "worker:tp02c:B:" + randomUUID();
      workerCId = "worker:tp02c:C:" + randomUUID();

      workerBKey = randomUUID();
      workerCKey = randomUUID();
      workerBCompletedKey = randomUUID();

      log(`Worker A (${workerAId}) acquiring lock '${lockKey}' via Modules.LOCKING (ttl=120)...`);
      await lockingService.acquire(lockKey, { ownerId: workerAId, expire: 120 });
      const workerAInRedisVal = await redisClient.get(createdRedisPrefixedKey);
      const workerATtl = await redisClient.ttl(createdRedisPrefixedKey);

      // 4. Create database leases before lock attempt
      // - Worker B pending lease (the one that should be CAS-aborted on timeout)
      await pgClient.query(
        `INSERT INTO idempotency_key (
           key, request_path, request_hash, status, lease_owner_id,
           locked_at, last_heartbeat_at, expires_at
         ) VALUES ($1, $2, $3, 'pending', $4, NOW(), NOW(), NOW() + INTERVAL '14 days')`,
        [workerBKey, "/store/carts/test/complete", "b".repeat(64), workerBId]
      );

      // - Worker C pending lease (control: must NOT be deleted by Worker B's timeout)
      await pgClient.query(
        `INSERT INTO idempotency_key (
           key, request_path, request_hash, status, lease_owner_id,
           locked_at, last_heartbeat_at, expires_at
         ) VALUES ($1, $2, $3, 'pending', $4, NOW(), NOW(), NOW() + INTERVAL '14 days')`,
        [workerCKey, "/store/carts/test/complete", "c".repeat(64), workerCId]
      );

      // - Worker B completed lease (control: must NOT be deleted because status != 'pending')
      await pgClient.query(
        `INSERT INTO idempotency_key (
           key, request_path, request_hash, status, lease_owner_id,
           locked_at, last_heartbeat_at, expires_at
         ) VALUES ($1, $2, $3, 'completed', $4, NOW(), NOW(), NOW() + INTERVAL '14 days')`,
        [workerBCompletedKey, "/store/carts/test/complete", "d".repeat(64), workerBId]
      );

      // Capture pre-contention database snapshot
      const queryLeases = async () => {
        const res = await pgClient.query(
          "SELECT key, status, lease_owner_id, locked_at, last_heartbeat_at FROM idempotency_key WHERE key IN ($1, $2, $3) ORDER BY key",
          [workerBKey, workerCKey, workerBCompletedKey]
        );
        return res.rows;
      };

      const beforeLeases = await queryLeases();
      // Exercise the guards against the SAME keys: unrelated control keys
      // alone cannot detect a missing owner/status predicate in the DELETE.
      const resolvePgConnection = () => container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
      await abortPendingLeaseOnLockTimeout(
        { idempotencyKey: workerCKey, ownerId: workerBId }, resolvePgConnection
      );
      await abortPendingLeaseOnLockTimeout(
        { idempotencyKey: workerBCompletedKey, ownerId: workerBId }, resolvePgConnection
      );
      const afterGuardProbes = await queryLeases();
      assertions.push({
        name: "same_key_wrong_owner_and_completed_lease_cas_probes_are_noops",
        category: "behavioral",
        expected: beforeLeases,
        actual: afterGuardProbes,
        passed: JSON.stringify(beforeLeases) === JSON.stringify(afterGuardProbes),
        detail: "Real container PostgreSQL connection executes CAS on an existing foreign-owned key and an existing completed key.",
      });
      dbBeforeSnapshot = {
        capturedAt: new Date().toISOString(),
        leases: beforeLeases,
        redisLock: { key: createdRedisPrefixedKey, owner: workerAInRedisVal, ttl: workerATtl },
      };

      // 5. Worker B executes workflow against same cart with timeout 5 and idempotencyKey
      log(`Worker B (${workerBId}) executing stage2CheckoutLockWorkflow with timeout=5s and idempotencyKey=${workerBKey}...`);
      const startMs = performance.now();
      let workerBCaughtError = null;
      try {
        const workflow = stage2CheckoutLockWorkflow(container);
        await workflow.run({
          input: {
            cartId,
            ownerId: workerBId,
            ttl: 120,
            timeout: 5,
            idempotencyKey: workerBKey,
          },
        });
      } catch (err) {
        workerBCaughtError = err;
      }
      const durationSeconds = (performance.now() - startMs) / 1000;
      log(`Worker B finished in ${durationSeconds.toFixed(3)}s with error: ${workerBCaughtError?.message || "none"}`);

      // 6. Capture post-contention database snapshot
      const afterLeases = await queryLeases();
      const postWorkerAVal = await redisClient.get(createdRedisPrefixedKey);
      const postWorkerATtl = await redisClient.ttl(createdRedisPrefixedKey);

      dbAfterSnapshot = {
        capturedAt: new Date().toISOString(),
        leases: afterLeases,
        redisLock: { key: createdRedisPrefixedKey, owner: postWorkerAVal, ttl: postWorkerATtl },
      };

      dbQueries = {
        before: `-- TP-02c DB Snapshot: Before Worker B Lock Contention\n` + formatSqlTable(beforeLeases),
        after: `-- TP-02c DB Snapshot: After Worker B Lock Timeout CAS Abort\n` + formatSqlTable(afterLeases),
      };

      // 7. Verify CAS deletion results
      const workerBPendingAfter = afterLeases.find((r) => r.key === workerBKey);
      const workerCPendingAfter = afterLeases.find((r) => r.key === workerCKey);
      const workerBCompletedAfter = afterLeases.find((r) => r.key === workerBCompletedKey);

      const add = (name, category, expected, actual, passed, detail) =>
        assertions.push({ name, category, expected, actual, passed, detail });

      add("target_services_verified_disposable", "safety", true, disposableCheck?.verified === true, disposableCheck?.verified === true, `Profile: ${disposableCheck?.executionProfile}`);
      add("disposable_validator_self_checks_passed", "safety", validatorSelfCheck.total, validatorSelfCheck.passed, validatorSelfCheck.allPassed === true, `${validatorSelfCheck.passed}/${validatorSelfCheck.total} passed`);
      add("postgres_service_connected", "infrastructure", true, Boolean(pgClient), Boolean(pgClient), "PG connected");
      add("redis_service_connected", "infrastructure", "PONG", redisPing, redisPing === "PONG", "Redis PONG");

      add("cart_checkout_session_table_present", "schema", true, sessionTablePresent, sessionTablePresent === true, "Session table present");
      add("cart_table_present", "schema", true, cartTablePresent, cartTablePresent === true, "Cart table present");
      add("idempotency_key_table_present", "schema", true, idempotencyTablePresent, idempotencyTablePresent === true, "idempotency_key table present");

      add("real_medusa_container_booted", "configuration", true, Boolean(container), Boolean(container), "Medusa container booted");
      add("locking_module_resolved", "configuration", true, Boolean(lockingService?.acquire), Boolean(lockingService?.acquire), "Modules.LOCKING resolved");
      add("system_security_module_resolved", "configuration", true, Boolean(systemSecurityService), Boolean(systemSecurityService), "system_security resolved");

      add("worker_a_acquired_initial_lock", "behavioral", workerAId, workerAInRedisVal, workerAInRedisVal === workerAId, "Worker A lock in Redis");
      add("worker_b_lease_existed_before_timeout", "behavioral", true, Boolean(beforeLeases.find((r) => r.key === workerBKey)), Boolean(beforeLeases.find((r) => r.key === workerBKey)), "Worker B lease pending before contention");

      add("worker_b_threw_conflict_error", "behavioral", true, Boolean(workerBCaughtError), Boolean(workerBCaughtError), "Worker B threw on lock timeout");
      add("worker_b_error_type_is_conflict", "behavioral", MedusaError.Types.CONFLICT, workerBCaughtError?.type, workerBCaughtError?.type === MedusaError.Types.CONFLICT || workerBCaughtError?.type === "conflict", `Error type: ${workerBCaughtError?.type}`);
      add("worker_b_error_code_is_lock_timeout", "behavioral", "LOCK_TIMEOUT", workerBCaughtError?.code, workerBCaughtError?.code === "LOCK_TIMEOUT", `Code: ${workerBCaughtError?.code}`);
      add("worker_b_contention_duration_within_window", "behavioral", "5.0s ± 0.5s", `${durationSeconds.toFixed(3)}s`, durationSeconds >= 4.5 && durationSeconds <= 5.5, `Duration: ${durationSeconds.toFixed(3)}s`);

      add("worker_b_pending_lease_cas_deleted_on_timeout", "behavioral", null, workerBPendingAfter ?? null, !workerBPendingAfter, "Worker B pending lease was deleted by CAS on lock timeout (no orphaned lease)");
      add("worker_c_pending_lease_preserved_unaltered", "behavioral", workerCId, workerCPendingAfter?.lease_owner_id, workerCPendingAfter?.lease_owner_id === workerCId && workerCPendingAfter?.status === "pending", "Worker C lease owned by different worker preserved intact");
      add("worker_b_completed_lease_preserved_unaltered", "behavioral", "completed", workerBCompletedAfter?.status, workerBCompletedAfter?.status === "completed", "Worker B completed lease preserved (status guard respected)");

      add("worker_a_lock_preserved_key_exists", "behavioral", 1, postWorkerAVal !== null ? 1 : 0, postWorkerAVal !== null, "Worker A Redis lock still exists");
      add("worker_a_lock_preserved_owner_matches", "behavioral", workerAId, postWorkerAVal, postWorkerAVal === workerAId, "Worker A owner preserved");
      add("worker_a_lock_preserved_ttl_positive", "behavioral", true, postWorkerATtl > 0, postWorkerATtl > 0, `TTL: ${postWorkerATtl}s`);
    }
  } catch (error) {
    caughtException = error;
    logErr("UNCAUGHT EXCEPTION during TP-02c: " + (error?.stack || String(error)));
  } finally {
    if (lockingService && createdCartId && workerAId) {
      try {
        log(`Worker A (${workerAId}) releasing lock for cart:${createdCartId}...`);
        await lockingService.release("cart:" + createdCartId, { ownerId: workerAId });
      } catch (err) {
        cleanupErrors.push("worker A lock release: " + err.message);
      }
    }
    if (pgClient) {
      for (const k of [workerBKey, workerCKey, workerBCompletedKey].filter(Boolean)) {
        try {
          await pgClient.query("DELETE FROM idempotency_key WHERE key = $1;", [k]);
        } catch (err) {
          cleanupErrors.push("idempotency_key cleanup: " + err.message);
        }
      }
      if (createdCartId) {
        try {
          await pgClient.query("DELETE FROM cart_checkout_session WHERE cart_id = $1;", [createdCartId]);
          await pgClient.query("DELETE FROM cart WHERE id = $1;", [createdCartId]);
        } catch (err) {
          cleanupErrors.push("db cart cleanup: " + err.message);
        }
      }
    }
    if (redisClient && createdRedisPrefixedKey && workerAId) {
      await cleanupRedisLockKey(redisClient, createdRedisPrefixedKey, workerAId, { log, logErr, cleanupErrors });
    }
    await safeCloseClients({ pgClient, redisClient, log, logErr, cleanupErrors });
  }

  const cleanupSucceeded = cleanupErrors.length === 0;
  if (createdCartId || createdRedisPrefixedKey) {
    assertions.push({
      name: "test_fixture_cleanup_succeeded",
      expected: true,
      actual: cleanupSucceeded,
      passed: cleanupSucceeded,
      category: "lifecycle",
      detail: cleanupSucceeded ? "All fixtures and locks cleaned up successfully." : "Cleanup failed: " + cleanupErrors.join("; "),
    });
  }

  if (caughtException) {
    assertions.push({ name: "uncaught_exception_free_execution", expected: true, actual: false, passed: false, category: "reliability", detail: caughtException.message || String(caughtException) });
    testStatus = "failed";
    exitCode = 1;
  } else if (blockerReason) {
    testStatus = "blocked";
    exitCode = 1;
  } else {
    const failedAssertions = assertions.filter((a) => !a.passed);
    const allPassed = failedAssertions.length === 0 && cleanupSucceeded;
    testStatus = allPassed ? "passed" : "failed";
    exitCode = allPassed ? 0 : 1;
  }

  const failedAssertions = assertions.filter((a) => !a.passed);
  log("");
  log(`TP-02c Assertion Summary: ${assertions.length - failedAssertions.length}/${assertions.length} passed.`);
  for (const a of assertions) {
    log((a.passed ? "PASS" : "FAIL") + " [" + a.name + "] (" + a.category + "): expected=" + JSON.stringify(a.expected) + " actual=" + JSON.stringify(a.actual));
  }

  await writeEvidence({
    status: testStatus,
    blocker: testStatus === "passed" ? null : (blockerReason || failedAssertions.map((f) => f.name).join(", ")),
    assertions,
    exitCode,
    dbBefore: dbBeforeSnapshot,
    dbAfter: dbAfterSnapshot,
    dbQueries,
    containerDetails,
  });

  if (testStatus === "passed") {
    log("SUCCESS: TP-02c executed and all assertions passed. Evidence written to artifacts/tp-evidence/TP-02c/");
  } else {
    logErr(`FAIL: TP-02c status is '${testStatus}' (exitCode=${exitCode}).`);
  }

  return exitCode;
}

const finalExitCode = await runTp02cTest();
process.exit(finalExitCode);

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
const { MedusaError, Modules } = rootRequire("@medusajs/framework/utils");
const { stage2CheckoutLockWorkflow } = rootRequire(
  path.join(backendRoot, "src", "workflows", "stage2-checkout-lock-workflow.ts")
);

const evidenceDir = path.join(repositoryRoot, "artifacts", "tp-evidence", "TP-03");
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
    tpId: "TP-03",
    title: "Concurrent Cart Lock Rejection",
    batch: "A",
    assessmentType: "behavioral acceptance test (workflow-level only, partial)",
    startedAt,
    commitSha: metadata.commitSha,
    nodeVersion: metadata.nodeVersion,
    npmVersion: metadata.npmVersion,
    packageLockSha256: metadata.packageLockSha256,
    testCommand: "node apps/backend/scripts/test-tp03-concurrent-lock-rejection.mjs",
    note: args.status === "passed"
      ? "TP-03 executed against real Medusa container and disposable PostgreSQL/Redis. Verified workflow-level LockTimeoutError mapped to MedusaError(CONFLICT, LOCK_TIMEOUT) after 5.0s ± 0.5s contention. HTTP 409 route not exercised (partial). Ready for independent review."
      : "TP-03 execution blocked by missing prerequisites, safety refusal, or environment service failure.",
    logLines,
    errLines,
    ...args,
  });
}

async function runTp03Test() {
  log(`=== Starting TP-03: Concurrent Cart Lock Rejection (Workflow-Level Behavioral Test) ===`);
  log(`Time: ${startedAt} | Commit: ${metadata.commitSha} | Node: ${metadata.nodeVersion}`);

  if (!databaseUrl || !redisUrl) {
    const reason = "DATABASE_URL or LOCKING_REDIS_URL / REDIS_URL not configured. Disposable services required.";
    logErr("BLOCKED TP-03: " + reason);
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
    logErr("BLOCKED TP-03: " + reason);
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

  let pgClient = null, redisClient = null, createdCartId = null, createdRedisPrefixedKey = null;
  let workerAId = null, controlWorkerBId = null, lockingService = null, testStatus = "failed", exitCode = 1;
  let blockerReason = null, assertions = [], dbBeforeSnapshot = null, dbAfterSnapshot = null;
  let dbQueries = null, containerDetails = null, caughtException = null;
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
    const reservationTablePresent = await checkTable("cart_batch_reservation");
    const nativeReservationTablePresent = await checkTable("reservation_item");

    if (!sessionTablePresent || !cartTablePresent || !reservationTablePresent || !nativeReservationTablePresent) {
      blockerReason = `Required tables missing: cart_checkout_session=${sessionTablePresent}, cart=${cartTablePresent}, cart_batch_reservation=${reservationTablePresent}, reservation_item=${nativeReservationTablePresent}`;
      logErr("BLOCKED TP-03: " + blockerReason);
      testStatus = "blocked";
    } else {
      log("Loading REAL Medusa container from " + backendRoot + "...");
      const container = await loadMedusaContainer();
      log("REAL Medusa container initialized successfully.");

      lockingService = container.resolve(Modules.LOCKING);
      const batchInventoryService = container.resolve("batch_inventory");
      const cartService = container.resolve(Modules.CART);
      const providerId = lockingService?.defaultProviderId;
      const providerInstance = lockingService?.providerService_?.retrieveProviderRegistration(providerId);
      const providerPrefix = providerInstance?.keyNamePrefix ?? providerInstance?.prefix ?? "medusa_lock:";

      containerDetails = {
        lockingProviderId: providerId,
        lockingKeyPrefix: providerPrefix,
        lockingModuleResolved: Boolean(lockingService),
        batchInventoryModuleResolved: Boolean(batchInventoryService),
        cartModuleResolved: Boolean(cartService),
      };

      // 1. Create real Cart fixture
      const realCart = await cartService.createCarts({
        currency_code: "usd",
        metadata: { test_fixture: "TP-03", created_at: new Date().toISOString() },
      });
      const cartId = realCart.id;
      createdCartId = cartId;

      // 2. Create associated cart_checkout_session fixture
      const attemptId = randomUUID();
      await batchInventoryService.createCartCheckoutSessions({
        cart_id: cartId,
        current_attempt_id: attemptId,
        epoch: 1,
        status: "in_progress",
      });

      // 2b. Positive control: Worker B acquires free lock on cart, verifies Redis ownership/TTL, and releases it
      const lockKey = "cart:" + cartId;
      createdRedisPrefixedKey = providerPrefix + lockKey;
      controlWorkerBId = "worker:tp03:B:control:" + randomUUID();
      let controlSuccess = false;
      try {
        const controlWf = stage2CheckoutLockWorkflow(container);
        const controlRes = await controlWf.run({ input: { cartId, ownerId: controlWorkerBId, ttl: 120, timeout: 5 } });
        controlSuccess = Boolean(controlRes?.result?.key === lockKey && controlRes?.result?.ownerId === controlWorkerBId);
      } catch (err) {
        logErr("Control Worker B acquisition failed: " + err.message);
      }

      const controlRedisOwner = await redisClient.get(createdRedisPrefixedKey);
      const controlRedisTtl = await redisClient.ttl(createdRedisPrefixedKey);
      const controlOwnerValid = controlRedisOwner === controlWorkerBId;
      const controlTtlValid = controlRedisTtl > 110 && controlRedisTtl <= 120;
      await lockingService.release(lockKey, { ownerId: controlWorkerBId });
      const postControlVal = await redisClient.get(createdRedisPrefixedKey);
      const postControlExists = await redisClient.exists(createdRedisPrefixedKey);
      const controlReleased = postControlExists === 0 && postControlVal === null;
      log(`Positive control: acquired=${controlSuccess}, ownerValid=${controlOwnerValid}, ttl=${controlRedisTtl}s, released=${controlReleased}`);

      // 3. Worker A acquires cart lock via real container locking module
      workerAId = "worker:tp03:A:" + randomUUID();
      const workerBId = "worker:tp03:B:" + randomUUID();

      log(`Worker A (${workerAId}) acquiring lock '${lockKey}' via Modules.LOCKING (ttl=120)...`);
      await lockingService.acquire(lockKey, { ownerId: workerAId, expire: 120 });
      const workerAInRedisVal = await redisClient.get(createdRedisPrefixedKey);

      // 4. Capture genuine pre-workflow database snapshot
      const ccsCols = ["cart_id", "current_attempt_id", "epoch", "status", "created_at", "updated_at", "deleted_at"];
      const ccsBeforeRes = await pgClient.query("SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = $1", [cartId]);
      const cbrBeforeRes = await pgClient.query("SELECT * FROM cart_batch_reservation WHERE cart_id = $1", [cartId]);
      let nativeResBeforeCount = null;
      if (nativeReservationTablePresent) {
        const nativeRes = await pgClient.query("SELECT COUNT(*)::int AS cnt FROM reservation_item");
        nativeResBeforeCount = Number(nativeRes.rows[0]?.cnt ?? 0);
      }
      dbBeforeSnapshot = {
        capturedAt: new Date().toISOString(),
        cartCheckoutSession: ccsBeforeRes.rows,
        cartBatchReservation: cbrBeforeRes.rows,
        nativeReservationItemTablePresent,
        nativeReservationItemCount: nativeResBeforeCount,
      };

      // 5. Worker B executes workflow against same cart with timeout 5
      log(`Worker B (${workerBId}) executing stage2CheckoutLockWorkflow (timeout=5s)...`);
      const startMs = performance.now();
      let workerBCaughtError = null;
      try {
        const workflow = stage2CheckoutLockWorkflow(container);
        await workflow.run({ input: { cartId, ownerId: workerBId, ttl: 120, timeout: 5 } });
      } catch (err) {
        workerBCaughtError = err;
      }
      const durationSeconds = (performance.now() - startMs) / 1000;
      log(`Worker B finished in ${durationSeconds.toFixed(3)}s with error: ${workerBCaughtError?.message || "none"}`);

      // 6. Out-of-band Redis verification of preserved Worker A lock
      const postWorkerAVal = await redisClient.get(createdRedisPrefixedKey);
      const postWorkerATtl = await redisClient.ttl(createdRedisPrefixedKey);
      const postWorkerAExists = await redisClient.exists(createdRedisPrefixedKey);

      // 7. Capture genuine post-workflow database snapshot
      const ccsAfterRes = await pgClient.query("SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = $1", [cartId]);
      const cbrAfterRes = await pgClient.query("SELECT * FROM cart_batch_reservation WHERE cart_id = $1", [cartId]);
      let nativeResAfterCount = null;
      if (nativeReservationTablePresent) {
        const nativeRes = await pgClient.query("SELECT COUNT(*)::int AS cnt FROM reservation_item");
        nativeResAfterCount = Number(nativeRes.rows[0]?.cnt ?? 0);
      }
      dbAfterSnapshot = {
        capturedAt: new Date().toISOString(),
        cartCheckoutSession: ccsAfterRes.rows,
        cartBatchReservation: cbrAfterRes.rows,
        nativeReservationItemTablePresent,
        nativeReservationItemCount: nativeResAfterCount,
      };

      // 8. Inspect physical schema of cart_batch_reservation for reconciliation
      const cbrColsRes = await pgClient.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cart_batch_reservation'");
      const physicalCbrCols = cbrColsRes.rows.map((r) => r.column_name);

      const beforeCcsRows = dbBeforeSnapshot.cartCheckoutSession || [];
      const afterCcsRows = dbAfterSnapshot.cartCheckoutSession || [];
      const hasExactlyOneBefore = beforeCcsRows.length === 1;
      const hasExactlyOneAfter = afterCcsRows.length === 1;
      const beforeCcs = hasExactlyOneBefore ? beforeCcsRows[0] : null;
      const afterCcs = hasExactlyOneAfter ? afterCcsRows[0] : null;

      const nativeBeforeLabel = `\nSELECT COUNT(*) FROM reservation_item;\n-- Count: ${dbBeforeSnapshot.nativeReservationItemCount}\n`;
      const nativeAfterLabel = `\nSELECT COUNT(*) FROM reservation_item;\n-- Count: ${dbAfterSnapshot.nativeReservationItemCount}\n`;

      dbQueries = {
        before: `-- TP-03 DB Snapshot: Before Worker B\nSELECT * FROM cart_checkout_session WHERE cart_id = '${cartId}';\n` +
          formatSqlTable(dbBeforeSnapshot.cartCheckoutSession, ccsCols) +
          `\nSELECT * FROM cart_batch_reservation WHERE cart_id = '${cartId}';\n` +
          formatSqlTable(dbBeforeSnapshot.cartBatchReservation) + nativeBeforeLabel,
        after: `-- TP-03 DB Snapshot: After Worker B Rejection\nSELECT * FROM cart_checkout_session WHERE cart_id = '${cartId}';\n` +
          formatSqlTable(dbAfterSnapshot.cartCheckoutSession, ccsCols) +
          `\nSELECT * FROM cart_batch_reservation WHERE cart_id = '${cartId}';\n` +
          formatSqlTable(dbAfterSnapshot.cartBatchReservation) + nativeAfterLabel,
      };

      // 9. Assertions compilation
      const add = (name, category, expected, actual, passed, detail) =>
        assertions.push({ name, category, expected, actual, passed, detail });

      add("target_services_verified_disposable", "safety", true, disposableCheck?.verified === true, disposableCheck?.verified === true, `Profile: ${disposableCheck?.executionProfile}`);
      add("disposable_validator_self_checks_passed", "safety", validatorSelfCheck.total, validatorSelfCheck.passed, validatorSelfCheck.allPassed === true, `${validatorSelfCheck.passed}/${validatorSelfCheck.total} passed`);
      add("postgres_service_connected", "infrastructure", true, Boolean(pgClient), Boolean(pgClient), "PG connected");
      add("redis_service_connected", "infrastructure", "PONG", redisPing, redisPing === "PONG", "Redis PONG");
      add("cart_checkout_session_table_present", "schema", true, sessionTablePresent, sessionTablePresent === true, "Session table present");
      add("cart_table_present", "schema", true, cartTablePresent, cartTablePresent === true, "Cart table present");
      add("cart_batch_reservation_table_present", "schema", true, reservationTablePresent, reservationTablePresent === true, "Reservation table present");
      add("reservation_item_table_present", "schema", true, nativeReservationTablePresent, nativeReservationTablePresent === true, "Native Medusa reservation_item table present in public schema");

      add("real_medusa_container_booted", "configuration", true, Boolean(container), Boolean(container), "Medusa container booted");
      add("locking_module_resolved_from_container", "configuration", true, Boolean(lockingService?.acquire), Boolean(lockingService?.acquire), "Modules.LOCKING resolved");
      add("batch_inventory_module_resolved_from_container", "configuration", true, Boolean(batchInventoryService), Boolean(batchInventoryService), "batch_inventory resolved");
      add("cart_module_resolved_from_container", "configuration", true, Boolean(cartService), Boolean(cartService), "Modules.CART resolved");

      add("real_cart_created_via_medusa_service", "fixture", true, Boolean(realCart?.id?.startsWith("cart_")), Boolean(realCart?.id?.startsWith("cart_")), `Cart ID: ${cartId}`);
      add("cart_checkout_session_linked_to_real_cart", "fixture", cartId, beforeCcs?.cart_id, beforeCcs?.cart_id === cartId, "Linked cart_id match");

      add("control_worker_b_acquires_free_lock", "control", true, controlSuccess, controlSuccess === true, "Worker B acquired free lock via workflow");
      add("control_redis_owner_is_worker_b", "control", { owner: controlWorkerBId, ttlValid: true }, { owner: controlRedisOwner, ttl: controlRedisTtl }, controlOwnerValid && controlTtlValid, `Owner matches; TTL=${controlRedisTtl}s in (110, 120]`);
      add("control_lock_released_before_contention", "control", true, controlReleased, controlReleased === true, "Control lock released and deleted before contention test");

      add("worker_a_acquired_lock_via_container_locking_module", "behavioral", workerAId, workerAInRedisVal, workerAInRedisVal === workerAId, "Worker A lock in Redis");

      add("worker_b_workflow_threw_error", "behavioral", true, Boolean(workerBCaughtError), Boolean(workerBCaughtError), "Worker B threw on contention");
      add("worker_b_error_type_is_conflict", "behavioral", MedusaError.Types.CONFLICT, workerBCaughtError?.type, workerBCaughtError?.type === MedusaError.Types.CONFLICT || workerBCaughtError?.type === "conflict", `Error type: ${workerBCaughtError?.type}`);
      add("worker_b_error_code_is_lock_timeout", "behavioral", "LOCK_TIMEOUT", workerBCaughtError?.code, workerBCaughtError?.code === "LOCK_TIMEOUT", `Code: ${workerBCaughtError?.code}`);
      add("worker_b_error_message_matches", "behavioral", "Cart checkout lock timeout", workerBCaughtError?.message, workerBCaughtError?.message === "Cart checkout lock timeout", `Message: ${workerBCaughtError?.message}`);
      add("worker_b_contention_duration_within_window", "behavioral", "5.0s ± 0.5s", `${durationSeconds.toFixed(3)}s`, durationSeconds >= 4.5 && durationSeconds <= 5.5, `Duration: ${durationSeconds.toFixed(3)}s`);

      add("worker_a_lock_preserved_key_exists", "behavioral", 1, postWorkerAExists, postWorkerAExists === 1, "Redis key still exists");
      add("worker_a_lock_preserved_owner_matches", "behavioral", workerAId, postWorkerAVal, postWorkerAVal === workerAId, "Worker A owner preserved");
      add("worker_a_lock_preserved_ttl_positive", "behavioral", true, postWorkerATtl > 0, postWorkerATtl > 0, `TTL: ${postWorkerATtl}s`);

      add("cart_checkout_session_row_cardinality_exactly_one", "behavioral", { before: 1, after: 1 }, { before: beforeCcsRows.length, after: afterCcsRows.length }, hasExactlyOneBefore && hasExactlyOneAfter, `Cart checkout session has exactly 1 row before (${beforeCcsRows.length}) and after (${afterCcsRows.length})`);
      add("cart_checkout_session_attempt_id_unaltered", "behavioral", beforeCcs?.current_attempt_id, afterCcs?.current_attempt_id, Boolean(hasExactlyOneBefore && hasExactlyOneAfter && beforeCcs && afterCcs && beforeCcs.current_attempt_id === afterCcs.current_attempt_id), "attempt_id unaltered");
      add("cart_checkout_session_epoch_unaltered", "behavioral", 1, Number(afterCcs?.epoch), hasExactlyOneBefore && hasExactlyOneAfter && Number(beforeCcs?.epoch) === 1 && Number(afterCcs?.epoch) === 1, "epoch 1 unaltered");
      add("cart_checkout_session_status_unaltered", "behavioral", "in_progress", afterCcs?.status, hasExactlyOneBefore && hasExactlyOneAfter && beforeCcs?.status === "in_progress" && afterCcs?.status === "in_progress", "status unaltered");
      const deletedAtMatches = Boolean(
        hasExactlyOneBefore && hasExactlyOneAfter && beforeCcs && afterCcs &&
        ((beforeCcs.deleted_at === null && afterCcs.deleted_at === null) ||
         (beforeCcs.deleted_at && afterCcs.deleted_at && new Date(beforeCcs.deleted_at).toISOString() === new Date(afterCcs.deleted_at).toISOString()) ||
         beforeCcs.deleted_at === afterCcs.deleted_at)
      );
      add("cart_checkout_session_deleted_at_unaltered", "behavioral", beforeCcs?.deleted_at ?? null, afterCcs?.deleted_at ?? null, deletedAtMatches, `deleted_at unaltered: before=${beforeCcs?.deleted_at}, after=${afterCcs?.deleted_at}`);

      const allSessionFieldsMatch = Boolean(
        hasExactlyOneBefore && hasExactlyOneAfter && beforeCcs && afterCcs &&
        beforeCcs.cart_id === afterCcs.cart_id && beforeCcs.current_attempt_id === afterCcs.current_attempt_id &&
        Number(beforeCcs.epoch) === Number(afterCcs.epoch) && beforeCcs.status === afterCcs.status &&
        new Date(beforeCcs.created_at).toISOString() === new Date(afterCcs.created_at).toISOString() &&
        new Date(beforeCcs.updated_at).toISOString() === new Date(afterCcs.updated_at).toISOString() &&
        deletedAtMatches
      );
      add("cart_checkout_session_all_fields_unaltered", "behavioral", true, allSessionFieldsMatch, allSessionFieldsMatch, "All 7 session columns (cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at) unaltered with exactly 1 row before and after");

      add("cart_batch_reservation_zero_rows_before_and_after", "behavioral", { before: 0, after: 0 }, { before: dbBeforeSnapshot.cartBatchReservation.length, after: dbAfterSnapshot.cartBatchReservation.length }, dbBeforeSnapshot.cartBatchReservation.length === 0 && dbAfterSnapshot.cartBatchReservation.length === 0, "Zero reservations");

      const nativeCountsValid = nativeReservationTablePresent === true &&
        typeof dbBeforeSnapshot.nativeReservationItemCount === "number" &&
        typeof dbAfterSnapshot.nativeReservationItemCount === "number" &&
        dbBeforeSnapshot.nativeReservationItemCount === dbAfterSnapshot.nativeReservationItemCount;

      add(
        "native_inventory_reservation_item_count_unchanged_before_and_after",
        "behavioral",
        nativeReservationTablePresent ? dbBeforeSnapshot.nativeReservationItemCount : "table reservation_item present",
        nativeReservationTablePresent ? dbAfterSnapshot.nativeReservationItemCount : "table reservation_item missing",
        nativeCountsValid,
        nativeCountsValid
          ? `Native Medusa reservation_item table count verified table-wide on disposable database (${dbBeforeSnapshot.nativeReservationItemCount} -> ${dbAfterSnapshot.nativeReservationItemCount}). Documented limitation: target cart has no line items in Stage 2 lock test; count proves zero rows created table-wide, not cart-scoped query filtering.`
          : "FAIL: reservation_item table missing or count unavailable; cannot assume zero or pass invariant."
      );

      const hasRequiredCols = ["id", "checkout_attempt_id", "cart_id", "checkout_line_key", "checkout_epoch", "batch_id", "quantity", "unit_cost_snapshot", "status", "expires_at"].every((c) => physicalCbrCols.includes(c));
      add("cart_batch_reservation_schema_reconciled", "schema", true, hasRequiredCols, hasRequiredCols, `Columns: [${physicalCbrCols.join(", ")}]`);
    }
  } catch (error) {
    caughtException = error;
    logErr("UNCAUGHT EXCEPTION during TP-03: " + (error?.stack || String(error)));
  } finally {
    if (lockingService && createdCartId && controlWorkerBId) {
      try {
        await lockingService.release("cart:" + createdCartId, { ownerId: controlWorkerBId });
      } catch {
        // already released or not acquired
      }
    }
    if (lockingService && createdCartId && workerAId) {
      try {
        log(`Worker A (${workerAId}) releasing lock for cart:${createdCartId}...`);
        await lockingService.release("cart:" + createdCartId, { ownerId: workerAId });
      } catch (err) {
        cleanupErrors.push("worker A lock release: " + err.message);
      }
    }
    if (createdCartId && pgClient) {
      try {
        await pgClient.query("DELETE FROM cart_batch_reservation WHERE cart_id = $1;", [createdCartId]);
        await pgClient.query("DELETE FROM cart_checkout_session WHERE cart_id = $1;", [createdCartId]);
        await pgClient.query("DELETE FROM cart WHERE id = $1;", [createdCartId]);
      } catch (err) {
        cleanupErrors.push("db cleanup: " + err.message);
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
  log(`TP-03 Assertion Summary: ${assertions.length - failedAssertions.length}/${assertions.length} passed.`);
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
    log("SUCCESS: TP-03 executed and all assertions passed. Evidence written to artifacts/tp-evidence/TP-03/");
  } else {
    logErr(`FAIL: TP-03 status is '${testStatus}' (exitCode=${exitCode}).`);
  }

  return exitCode;
}

const finalExitCode = await runTp03Test();
process.exit(finalExitCode);

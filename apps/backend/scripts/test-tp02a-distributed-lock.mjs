import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "../..");

const require = createRequire(import.meta.url);
const { Client: PgClient } = require("pg");
const RedisModule = require("ioredis");
const Redis = RedisModule.default ?? RedisModule;

// Register ts-node so that TypeScript workflow and module definitions can be imported directly
const rootRequire = createRequire(path.join(repositoryRoot, "package.json"));
rootRequire("ts-node").register({
  project: path.join(backendRoot, "tsconfig.json"),
  transpileOnly: true,
});

const { createContainer, asValue } = require("@medusajs/framework/awilix");
const { Modules } = require("@medusajs/framework/utils");
const { SafeRedisLockingProvider } = await import("../src/modules/locking-redis/index.mjs");
const { parentCheckoutTestWorkflow } = rootRequire(
  path.join(backendRoot, "src", "workflows", "test-tp02a-workflow.ts")
);

const evidenceDir = path.join(repositoryRoot, "artifacts", "tp-evidence", "TP-02a");
await mkdir(evidenceDir, { recursive: true });

const logLines = [];
const errLines = [];
function log(msg) {
  console.log(msg);
  logLines.push(msg);
}
function logErr(msg) {
  console.error(msg);
  errLines.push(msg);
}

function captureVersion(cmd, args) {
  try {
    const executable =
      process.platform === "win32" && !cmd.endsWith(".cmd") && !cmd.endsWith(".exe")
        ? `${cmd}.cmd`
        : cmd;
    return execFileSync(executable, args, { encoding: "utf8" }).trim();
  } catch {
    try {
      return execFileSync(cmd, args, { encoding: "utf8" }).trim();
    } catch {
      return "unavailable";
    }
  }
}

const startedAt = new Date().toISOString();
const commitSha = process.env.GITHUB_SHA || "local-head";
const nodeVersion = process.version;
const npmVersion = captureVersion("npm", ["--version"]);
let lockSha256 = null;
try {
  const lockContent = await readFile(path.join(repositoryRoot, "package-lock.json"));
  lockSha256 = createHash("sha256").update(lockContent).digest("hex");
} catch {
  // lockfile absence recorded as null
}

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.LOCKING_REDIS_URL || process.env.REDIS_URL;

async function writeEvidence({ status, blocker, assertions, exitCode, dbBefore, dbAfter, dbQueries }) {
  const endedAt = new Date().toISOString();
  const result = {
    schemaVersion: 1,
    tpId: "TP-02a",
    title: "Distributed Cart Lock Acquisition",
    batch: "A",
    status,
    assessmentType: status === "passed" ? "behavioral acceptance test" : "readiness check",
    startedAt,
    endedAt,
    commitSha,
    nodeVersion,
    npmVersion,
    packageLockSha256: lockSha256,
    databaseImageRef:
      process.env.PHASE1_POSTGRES_IMAGE_REF ||
      "postgres:16.15@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54",
    redisImageRef:
      process.env.PHASE1_REDIS_IMAGE_REF ||
      "redis:7.2.16@sha256:1009f15ccd9ed271996d1c65745a1ab1dadedea188feb3f1ab938602a32e50a3",
    testCommand: "node apps/backend/scripts/test-tp02a-distributed-lock.mjs",
    processExitCode: exitCode,
    behavioralTestExitCode: status === "passed" ? 0 : 1,
    behavioralTestExecuted: status === "passed",
    blocker: blocker || null,
    dbBefore: "db-before.json",
    dbAfter: "db-after.json",
    note:
      status === "passed"
        ? "TP-02a executed once against real PostgreSQL and Redis services. Awaits independent review."
        : "TP-02a execution blocked by missing prerequisites or environment service failure.",
  };

  await writeFile(path.join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "assertions.json"), JSON.stringify(assertions, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "stdout.log"), logLines.join("\n") + "\n");
  await writeFile(path.join(evidenceDir, "stderr.log"), errLines.join("\n") + (errLines.length ? "\n" : ""));
  await writeFile(path.join(evidenceDir, "db-before.json"), JSON.stringify(dbBefore || {}, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "db-after.json"), JSON.stringify(dbAfter || {}, null, 2) + "\n");
  await writeFile(
    path.join(evidenceDir, "db-before.sql"),
    dbQueries?.before || "-- No database queries executed before test.\n"
  );
  await writeFile(
    path.join(evidenceDir, "db-after.sql"),
    dbQueries?.after || "-- No database queries executed after test.\n"
  );
}

log("=== Starting TP-02a: Distributed Cart Lock Acquisition ===");
log("Time: " + startedAt);
log("Commit: " + commitSha);
log("Node: " + nodeVersion + ", npm: " + npmVersion);

if (!databaseUrl || !redisUrl) {
  const reason = "DATABASE_URL or LOCKING_REDIS_URL / REDIS_URL not configured. Disposable services required.";
  logErr("BLOCKED TP-02a: " + reason);
  const assertions = [
    {
      name: "disposable_services_configured",
      expected: true,
      actual: false,
      passed: false,
      detail: reason,
    },
    {
      name: "status_not_misreported_as_pass",
      expected: "blocked",
      actual: "blocked",
      passed: true,
    },
  ];
  await writeEvidence({
    status: "blocked",
    blocker: reason,
    assertions,
    exitCode: 0,
    dbBefore: null,
    dbAfter: null,
    dbQueries: null,
  });
  process.exit(0);
}

let pgClient;
let redisClient;
let providerRedisClient;
let provider;

try {
  log("Connecting to PostgreSQL at " + databaseUrl.replace(/:[^:@]+@/, ":***@") + "...");
  pgClient = new PgClient({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await pgClient.connect();
  log("PostgreSQL connected successfully.");

  log("Connecting out-of-band Redis client at " + redisUrl.replace(/:[^:@]+@/, ":***@") + "...");
  redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redisClient.on("error", () => {});
  await redisClient.connect();
  log("Out-of-band Redis client connected successfully.");

  // Check if cart_checkout_session table exists in PostgreSQL
  const tableCheckRes = await pgClient.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cart_checkout_session'"
  );
  const tablePresent = tableCheckRes.rows.length > 0;
  log("cart_checkout_session table present: " + tablePresent);

  if (!tablePresent) {
    const reason = "Table 'cart_checkout_session' does not exist in PostgreSQL. Migration required.";
    logErr("BLOCKED TP-02a: " + reason);
    const assertions = [
      {
        name: "cart_checkout_session_table_present",
        expected: true,
        actual: false,
        passed: false,
        detail: reason,
      },
      {
        name: "status_not_misreported_as_pass",
        expected: "blocked",
        actual: "blocked",
        passed: true,
      },
    ];
    await writeEvidence({
      status: "blocked",
      blocker: reason,
      assertions,
      exitCode: 0,
      dbBefore: null,
      dbAfter: null,
      dbQueries: null,
    });
    process.exit(0);
  }

  // Generate test IDs
  const cartId = "cart_tp02a_" + randomUUID();
  const attemptId = randomUUID();
  const workerId = "worker:tp02a:" + randomUUID();
  const nestedWorkerId = "worker:nested:" + randomUUID();
  const lockKey = "cart:" + cartId;

  log("Fixture cart ID: " + cartId);
  log("Active attempt ID: " + attemptId);
  log("Worker ID: " + workerId);
  log("Lock Key: " + lockKey);

  // Pre-test DB snapshot
  const dbBeforeQuery = `SELECT * FROM cart_checkout_session WHERE cart_id = '${cartId}';\n`;
  const dbBeforeRes = await pgClient.query(
    "SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at FROM cart_checkout_session WHERE cart_id = $1",
    [cartId]
  );
  const dbBeforeSnapshot = {
    capturedAt: new Date().toISOString(),
    query: dbBeforeQuery.trim(),
    rows: dbBeforeRes.rows,
  };

  // Insert initial cart_checkout_session fixture row (per owner default assumption: first checkout attempt creates session with epoch = 1)
  const insertQuery = `
    INSERT INTO cart_checkout_session (cart_id, current_attempt_id, epoch, status, created_at, updated_at)
    VALUES ($1, $2, 1, 'in_progress', NOW(), NOW())
    ON CONFLICT (cart_id) DO UPDATE SET current_attempt_id = $2, epoch = 1, status = 'in_progress'
    RETURNING cart_id, current_attempt_id, epoch, status;
  `;
  const insertRes = await pgClient.query(insertQuery, [cartId, attemptId]);
  log("Provisioned fixture session: " + JSON.stringify(insertRes.rows[0]));

  // Initialize SafeRedisLockingProvider with its own dedicated client
  providerRedisClient = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  providerRedisClient.on("error", () => {});
  await providerRedisClient.connect();

  provider = new SafeRedisLockingProvider(
    { redisClient: providerRedisClient, prefix: "medusa_lock:" },
    {
      waitLockingTimeout: 5,
      defaultRetryInterval: 10,
      maximumRetryInterval: 50,
      backoffFactor: 2,
    }
  );

  const lockingService = {
    acquire: (keys, args) => provider.acquire(keys, args),
    release: (keys, args) => provider.release(keys, args),
    releaseAll: (args) => provider.releaseAll(args),
  };

  const container = createContainer();
  container.register({
    [Modules.LOCKING]: asValue(lockingService),
  });

  log("Executing parentCheckoutTestWorkflow with Medusa container...");
  const workflowInstance = parentCheckoutTestWorkflow(container);
  const workflowExecution = await workflowInstance.run({
    input: {
      key: lockKey,
      cartId,
      ttl: 120,
      timeout: 5,
      ownerId: workerId,
      nestedOwnerId: nestedWorkerId,
      redisUrl,
    },
  });

  log("Workflow execution finished with result: " + JSON.stringify(workflowExecution.result));

  const resultData = workflowExecution.result || {};
  const parentLock = resultData.parentLock;
  const nestedResult = resultData.nestedResult;
  const inFlightInspection = resultData.inFlightInspection;
  const releaseResult = resultData.releaseResult;

  // Post-workflow out-of-band Redis verification
  const postReleaseActualKey = inFlightInspection?.actualKey || "medusa_lock:" + lockKey;
  const postReleaseValue = await redisClient.get(postReleaseActualKey);
  const postReleaseRawValue = await redisClient.get(lockKey);
  log("Post-release Redis key (" + postReleaseActualKey + "): " + postReleaseValue);

  // Post-test DB snapshot
  const dbAfterQuery = `SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at FROM cart_checkout_session WHERE cart_id = '${cartId}';\n`;
  const dbAfterRes = await pgClient.query(
    "SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at FROM cart_checkout_session WHERE cart_id = $1",
    [cartId]
  );
  const dbAfterSnapshot = {
    capturedAt: new Date().toISOString(),
    query: dbAfterQuery.trim(),
    rows: dbAfterRes.rows,
  };

  // Compile assertions
  const assertions = [
    {
      name: "postgres_service_connected",
      expected: true,
      actual: true,
      passed: true,
    },
    {
      name: "redis_service_connected",
      expected: true,
      actual: true,
      passed: true,
    },
    {
      name: "cart_checkout_session_table_present",
      expected: true,
      actual: true,
      passed: true,
    },
    {
      name: "fixture_session_inserted",
      expected: { cart_id: cartId, epoch: "1", status: "in_progress" },
      actual: {
        cart_id: insertRes.rows[0]?.cart_id,
        epoch: String(insertRes.rows[0]?.epoch),
        status: insertRes.rows[0]?.status,
      },
      passed:
        insertRes.rows[0]?.cart_id === cartId &&
        String(insertRes.rows[0]?.epoch) === "1" &&
        insertRes.rows[0]?.status === "in_progress",
    },
    {
      name: "parent_lock_step_acquired",
      expected: true,
      actual: parentLock?.acquired === true,
      passed: parentLock?.acquired === true,
    },
    {
      name: "redis_lock_key_present_in_flight",
      expected: true,
      actual: inFlightInspection?.exists === true,
      passed: inFlightInspection?.exists === true,
      detail: "In-flight inspection discovered Redis key: " + inFlightInspection?.actualKey,
    },
    {
      name: "redis_lock_owner_match",
      expected: workerId,
      actual: inFlightInspection?.owner,
      passed: inFlightInspection?.owner === workerId,
    },
    {
      name: "redis_lock_ttl_within_window",
      expected: "> 110s and <= 120s",
      actual: inFlightInspection?.ttl,
      passed:
        typeof inFlightInspection?.ttl === "number" &&
        inFlightInspection.ttl > 110 &&
        inFlightInspection.ttl <= 120,
    },
    {
      name: "nested_subworkflow_lock_skipped",
      expected: { executed: true, nestedLockAcquired: false },
      actual: {
        executed: nestedResult?.executed === true,
        nestedLockAcquired: Boolean(nestedResult?.nestedLock?.acquired),
      },
      passed: nestedResult?.executed === true && !nestedResult?.nestedLock?.acquired,
      detail:
        "Sub-workflow acquireLockStep recognized parentStepIdempotencyKey and skipped re-acquisition without mutating held lock",
    },
    {
      name: "release_lock_step_succeeded",
      expected: true,
      actual: releaseResult === true,
      passed: releaseResult === true,
    },
    {
      name: "redis_lock_key_deleted_after_release",
      expected: null,
      actual: postReleaseValue,
      passed: postReleaseValue === null && postReleaseRawValue === null,
      detail: "Out-of-band Redis GET verified lock key is null after release",
    },
    {
      name: "cart_checkout_session_epoch_unaltered",
      expected: "1",
      actual: String(dbAfterRes.rows[0]?.epoch),
      passed: String(dbAfterRes.rows[0]?.epoch) === "1",
    },
    {
      name: "cart_checkout_session_status_unaltered",
      expected: "in_progress",
      actual: dbAfterRes.rows[0]?.status,
      passed: dbAfterRes.rows[0]?.status === "in_progress",
    },
  ];

  const failedAssertions = assertions.filter((a) => !a.passed);
  const allPassed = failedAssertions.length === 0;

  log("");
  log("TP-02a Assertion Summary: " + (assertions.length - failedAssertions.length) + "/" + assertions.length + " passed.");
  for (const a of assertions) {
    log((a.passed ? "PASS" : "FAIL") + " [" + a.name + "]: expected=" + JSON.stringify(a.expected) + " actual=" + JSON.stringify(a.actual));
  }

  const dbQueries = {
    before: "-- Snapshot before test execution:\n" + dbBeforeQuery + "\n-- Fixture provision query:\n" + insertQuery,
    after: "-- Snapshot after test execution:\n" + dbAfterQuery,
  };

  await writeEvidence({
    status: allPassed ? "passed" : "failed",
    blocker: allPassed ? null : failedAssertions.map((f) => f.name).join(", "),
    assertions,
    exitCode: allPassed ? 0 : 1,
    dbBefore: dbBeforeSnapshot,
    dbAfter: dbAfterSnapshot,
    dbQueries,
  });

  if (!allPassed) {
    logErr("FAIL: TP-02a assertions failed.");
    process.exit(1);
  }

  log("SUCCESS: TP-02a executed and all assertions passed. Evidence written to artifacts/tp-evidence/TP-02a/");
  process.exit(0);
} catch (error) {
  logErr("UNCAUGHT EXCEPTION during TP-02a: " + (error?.stack || String(error)));
  const assertions = [
    {
      name: "uncaught_exception_free_execution",
      expected: true,
      actual: false,
      passed: false,
      detail: error?.message || String(error),
    },
  ];
  await writeEvidence({
    status: "failed",
    blocker: error?.message || String(error),
    assertions,
    exitCode: 1,
    dbBefore: null,
    dbAfter: null,
    dbQueries: null,
  });
  process.exit(1);
} finally {
  try {
    if (redisClient?.status !== "end") redisClient?.disconnect();
  } catch {}
  try {
    if (providerRedisClient?.status !== "end") providerRedisClient?.disconnect();
  } catch {}
  try {
    await pgClient?.end();
  } catch {}
}

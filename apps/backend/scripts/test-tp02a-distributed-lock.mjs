import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { verifyDisposableTargetServices, runDisposableValidatorSelfChecks } from "./verify-disposable-target.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "../..");

const require = createRequire(import.meta.url);
const { Client: PgClient, Pool: PgPool } = require("pg");
const RedisModule = require("ioredis");
const Redis = RedisModule.default ?? RedisModule;

// Register ts-node so that TypeScript workflow and module definitions can be imported directly
const rootRequire = createRequire(path.join(repositoryRoot, "package.json"));
rootRequire("ts-node").register({
  project: path.join(backendRoot, "tsconfig.json"),
  transpileOnly: true,
});

const { Modules } = require("@medusajs/framework/utils");
const { parentCheckoutTestWorkflow } = rootRequire(
  path.join(backendRoot, "src", "workflows", "test-tp02a-workflow.ts")
);
const { CartCheckoutSession } = rootRequire(
  path.join(backendRoot, "src", "modules", "batch-inventory", "models", "cart-checkout-session.ts")
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

function formatSqlTable(rows, columns) {
  if (!rows || rows.length === 0) {
    return "(0 rows)\n";
  }
  const colKeys = columns || Object.keys(rows[0]);
  const header = colKeys.join(" | ");
  const separator = colKeys.map((c) => "-".repeat(Math.max(c.length, 8))).join("-+-");
  const dataLines = rows.map((r) =>
    colKeys
      .map((k) => {
        const val = r[k];
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "object") return JSON.stringify(val);
        return String(val);
      })
      .join(" | ")
  );
  return `${header}\n${separator}\n${dataLines.join("\n")}\n(${rows.length} row${rows.length === 1 ? "" : "s"})\n`;
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

async function writeEvidence({
  status,
  blocker,
  assertions,
  exitCode,
  dbBefore,
  dbAfter,
  dbQueries,
  containerDetails,
}) {
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
    containerDetails: containerDetails || null,
    note:
      status === "passed"
        ? "TP-02a executed against real Medusa container loaded from medusa-config.ts, with real Cart fixture, cart_checkout_session, and disposable PostgreSQL and Redis services. Awaits independent review."
        : "TP-02a execution blocked by missing prerequisites or environment service failure.",
  };

  await writeFile(path.join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "assertions.json"), JSON.stringify(assertions, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "stdout.log"), logLines.join("\n") + "\n");
  await writeFile(path.join(evidenceDir, "stderr.log"), errLines.join("\n") + (errLines.length ? "\n" : ""));
  await writeFile(path.join(evidenceDir, "dbBefore.json"), JSON.stringify(dbBefore || {}, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "dbAfter.json"), JSON.stringify(dbAfter || {}, null, 2) + "\n");
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

async function runTp02aTest() {
  log("=== Starting TP-02a: Distributed Cart Lock Acquisition (Real Medusa Container) ===");
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
      exitCode: 1,
      dbBefore: null,
      dbAfter: null,
      dbQueries: null,
      containerDetails: null,
    });
    return 1;
  }

  // Pre-connection safety validation
  let disposableCheck;
  try {
    disposableCheck = verifyDisposableTargetServices(databaseUrl, redisUrl);
    log("Target services verified disposable: " + JSON.stringify(disposableCheck));
  } catch (disposableErr) {
    const reason = "Target services safety check failed: " + disposableErr.message;
    logErr("BLOCKED TP-02a: " + reason);
    const assertions = [
      {
        name: "target_services_verified_disposable",
        expected: true,
        actual: false,
        passed: false,
        detail: reason,
      },
    ];
    await writeEvidence({
      status: "blocked",
      blocker: reason,
      assertions,
      exitCode: 1,
      dbBefore: null,
      dbAfter: null,
      dbQueries: null,
      containerDetails: null,
    });
    return 1;
  }

  // Run comprehensive validator self-checks
  const validatorSelfCheck = runDisposableValidatorSelfChecks();
  log(`Disposable target validator self-checks: ${validatorSelfCheck.passed}/${validatorSelfCheck.total} passed.`);

  let pgClient = null;
  let redisClient = null;
  let createdCartId = null;
  let createdLockKey = null;
  let createdRedisPrefixedKey = null;

  let testStatus = "failed";
  let exitCode = 1;
  let blockerReason = null;
  let assertions = [];
  let dbBeforeSnapshot = null;
  let dbAfterSnapshot = null;
  let dbQueries = null;
  let containerDetails = null;
  let caughtException = null;
  const cleanupErrors = [];

  try {
    log("Connecting direct PostgreSQL inspection client to " + databaseUrl.replace(/:[^:@]+@/, ":***@") + "...");
    pgClient = new PgClient({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await pgClient.connect();
    log("Direct PostgreSQL inspection client connected successfully.");

    log("Connecting direct out-of-band Redis client to " + redisUrl.replace(/:[^:@]+@/, ":***@") + "...");
    redisClient = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redisClient.on("error", () => {});
    await redisClient.connect();
    const redisPing = await redisClient.ping();
    log("Direct out-of-band Redis client connected successfully (PING=" + redisPing + ").");

    // Check if cart_checkout_session table exists in PostgreSQL
    const sessionTableCheckRes = await pgClient.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cart_checkout_session'"
    );
    const sessionTablePresent = sessionTableCheckRes.rows.length > 0;
    log("cart_checkout_session table present: " + sessionTablePresent);

    if (!sessionTablePresent) {
      blockerReason = "Table 'cart_checkout_session' does not exist in PostgreSQL. Migration required.";
      logErr("BLOCKED TP-02a: " + blockerReason);
      testStatus = "blocked";
      exitCode = 1;
      assertions.push({
        name: "cart_checkout_session_table_present",
        expected: true,
        actual: false,
        passed: false,
        category: "schema",
        detail: blockerReason,
      });
    } else {
      // Check if cart table exists in PostgreSQL
      const cartTableCheckRes = await pgClient.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cart'"
      );
      const cartTablePresent = cartTableCheckRes.rows.length > 0;
      log("cart table present in PostgreSQL: " + cartTablePresent);

      if (!cartTablePresent) {
        blockerReason = "Table 'cart' does not exist in PostgreSQL. Medusa baseline migration required.";
        logErr("BLOCKED TP-02a: " + blockerReason);
        testStatus = "blocked";
        exitCode = 1;
        assertions.push({
          name: "cart_table_present",
          expected: true,
          actual: false,
          passed: false,
          category: "schema",
          detail: blockerReason,
        });
      } else {
        // Boot the REAL Medusa container loaded from apps/backend/medusa-config.ts
        log("Loading REAL Medusa container from " + backendRoot + "...");
        const originalCwd = process.cwd();
        if (process.cwd() !== backendRoot) {
          process.chdir(backendRoot);
        }
        process.env.MEDUSA_WORKER_MODE = "server";

        const medusaLoadersModule = await import("@medusajs/medusa/loaders/index");
        const loaders = medusaLoadersModule.default?.default || medusaLoadersModule.default || medusaLoadersModule;
        const express = (await import("express")).default;
        const expressApp = express();

        const { container } = await loaders({
          directory: backendRoot,
          expressApp,
          skipLoadingEntryPoints: true,
        });
        log("REAL Medusa container initialized successfully.");

        // Revert working directory if needed
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
        }

        // Read runtime configuration declared in medusa-config.ts via container.resolve("configModule")
        const configModule = container.resolve("configModule");
        const lockingModuleConfig = configModule?.modules?.locking;
        const configuredProviderEntry = lockingModuleConfig?.options?.providers?.[0] || null;
        const configDeclaredResolve = configuredProviderEntry?.resolve || null;
        const configDeclaredId = configuredProviderEntry?.id || null;
        const configDeclaredIsDefault = Boolean(configuredProviderEntry?.is_default);

        // Resolve locking module, custom batch_inventory module, and canonical cart module from real container
        const lockingService = container.resolve(Modules.LOCKING);
        const batchInventoryService = container.resolve("batch_inventory");
        const cartService = container.resolve(Modules.CART);

        // Read running provider registration from container's locking service
        const containerDefaultProviderId = lockingService?.defaultProviderId;
        const providerInstance = lockingService?.providerService_?.retrieveProviderRegistration(containerDefaultProviderId);
        const providerClassName = providerInstance?.constructor?.name || null;
        // Read key prefix directly from running provider instance (SafeRedisLockingProvider defines keyNamePrefix)
        const providerConfiguredPrefix = providerInstance?.keyNamePrefix ?? providerInstance?.prefix ?? null;
        if (!providerConfiguredPrefix) {
          throw new Error("Unable to read key prefix from running provider instance.");
        }

        containerDetails = {
          creationMechanism: "@medusajs/medusa/loaders loaders.default({ directory: backendRoot, expressApp, skipLoadingEntryPoints: true })",
          medusaConfigFile: "apps/backend/medusa-config.ts",
          lockingProviderConfigured: configDeclaredResolve,
          lockingProviderId: containerDefaultProviderId,
          lockingProviderIsDefault: configDeclaredIsDefault,
          lockingKeyPrefix: providerConfiguredPrefix,
          batchInventoryModuleResolved: Boolean(batchInventoryService),
          lockingModuleResolved: Boolean(lockingService),
          cartModuleResolved: Boolean(cartService),
        };
        log("Container details (read dynamically at runtime): " + JSON.stringify(containerDetails));

        // Inspect physical database columns for cart_checkout_session to verify presence/absence of raw_epoch
        const columnsRes = await pgClient.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cart_checkout_session' ORDER BY ordinal_position"
        );
        const physicalColumnNames = columnsRes.rows.map((r) => r.column_name);
        const rawEpochColumnExistsInDb = physicalColumnNames.includes("raw_epoch");
        log("Physical columns in cart_checkout_session: " + physicalColumnNames.join(", "));
        log("raw_epoch column present in DB: " + rawEpochColumnExistsInDb);

        // Intercept real SQL queries executed during fixture creation
        const capturedFixtureSql = [];
        const originalPgQuery = PgClient.prototype.query;
        const originalPoolQuery = PgPool ? PgPool.prototype.query : null;

        const captureInterceptor = function (...args) {
          try {
            const qText = typeof args[0] === "string" ? args[0] : args[0]?.text;
            const qValues = Array.isArray(args[1]) ? args[1] : (Array.isArray(args[0]?.values) ? args[0].values : []);
            if (qText && (qText.includes("cart") || qText.includes("INSERT") || qText.includes("insert"))) {
              capturedFixtureSql.push({ text: qText.trim(), values: qValues });
            }
          } catch {}
          return originalPgQuery.apply(this, args);
        };

        PgClient.prototype.query = captureInterceptor;
        if (PgPool) {
          PgPool.prototype.query = function (...args) {
            try {
              const qText = typeof args[0] === "string" ? args[0] : args[0]?.text;
              const qValues = Array.isArray(args[1]) ? args[1] : (Array.isArray(args[0]?.values) ? args[0].values : []);
              if (qText && (qText.includes("cart") || qText.includes("INSERT") || qText.includes("insert"))) {
                capturedFixtureSql.push({ text: qText.trim(), values: qValues });
              }
            } catch {}
            return originalPoolQuery.apply(this, args);
          };
        }

        // 1. Create a REAL Cart using Medusa CartModuleService
        log("Creating real Cart fixture via cartService.createCarts...");
        let realCart;
        try {
          realCart = await cartService.createCarts({
            currency_code: "usd",
            metadata: {
              test_fixture: "TP-02a",
              created_at: new Date().toISOString(),
            },
          });
        } finally {
          PgClient.prototype.query = originalPgQuery;
          if (PgPool && originalPoolQuery) {
            PgPool.prototype.query = originalPoolQuery;
          }
        }

        const cartId = realCart.id;
        createdCartId = cartId;
        log("Real Cart created successfully with ID: " + cartId);

        // Verify real Cart exists in PostgreSQL table "cart"
        const cartDbRes = await pgClient.query(
          "SELECT id, currency_code, created_at FROM cart WHERE id = $1",
          [cartId]
        );
        log("Real Cart record verified in PostgreSQL cart table: " + JSON.stringify(cartDbRes.rows[0]));

        // 2. Create associated cart_checkout_session fixture via BatchInventoryModuleService
        const attemptId = randomUUID();
        const workerId = "worker:tp02a:" + randomUUID();
        const nestedWorkerId = "worker:nested:" + randomUUID();
        const lockKey = "cart:" + cartId;
        const redisPrefixedKey = providerConfiguredPrefix + lockKey;

        createdLockKey = lockKey;
        createdRedisPrefixedKey = redisPrefixedKey;

        log("Fixture cart ID: " + cartId);
        log("Active attempt ID: " + attemptId);
        log("Worker ID: " + workerId);
        log("Lock Key (logical): " + lockKey);
        log("Lock Key in Redis (prefixed): " + redisPrefixedKey);

        log("Creating cart_checkout_session fixture via BatchInventoryModuleService.createCartCheckoutSessions...");
        PgClient.prototype.query = captureInterceptor;
        if (PgPool) {
          PgPool.prototype.query = captureInterceptor;
        }

        let createdSession;
        try {
          createdSession = await batchInventoryService.createCartCheckoutSessions({
            cart_id: cartId,
            current_attempt_id: attemptId,
            epoch: 1,
            status: "in_progress",
          });
        } finally {
          PgClient.prototype.query = originalPgQuery;
          if (PgPool && originalPoolQuery) {
            PgPool.prototype.query = originalPoolQuery;
          }
        }

        log("Created fixture session via module service: " + JSON.stringify(createdSession));
        log("Captured SQL statements during fixture calls: " + capturedFixtureSql.length);

        // Read back via BatchInventoryModuleService
        const retrievedServiceSession = await batchInventoryService.retrieveCartCheckoutSession(cartId);
        log("Retrieved fixture session via module service: " + JSON.stringify(retrievedServiceSession));

        // Read back via raw SQL
        const rawSqlRes = await pgClient.query(
          "SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = $1",
          [cartId]
        );
        const rawSqlSession = rawSqlRes.rows[0];
        log("Retrieved fixture session via raw SQL: " + JSON.stringify(rawSqlSession));

        // 3. Capture database state immediately before executing the workflow (after fixture creation and validation)
        log("Capturing database snapshot immediately before workflow execution (after fixture validation)...");
        const dbBeforeQuery = `SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = '${cartId}';`;
        const dbBeforeRes = await pgClient.query(
          "SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = $1",
          [cartId]
        );
        dbBeforeSnapshot = {
          capturedAt: new Date().toISOString(),
          query: dbBeforeQuery,
          rows: dbBeforeRes.rows,
          cartQuery: `SELECT id, currency_code, created_at FROM cart WHERE id = '${cartId}';`,
          cartRows: cartDbRes.rows,
        };
        log("Pre-workflow database snapshot captured (rows: " + dbBeforeSnapshot.rows.length + ").");

        // 4. Execute parentCheckoutTestWorkflow using the real Medusa container
        log("Executing parentCheckoutTestWorkflow with real Medusa container...");
        const workflowInstance = parentCheckoutTestWorkflow(container);
        const workflowExecution = await workflowInstance.run({
          input: {
            key: lockKey,
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

        // 5. Post-workflow out-of-band Redis verification
        const lingeringMatchingKeys = await redisClient.keys("*" + lockKey);
        const postReleaseKeyExists = lingeringMatchingKeys.some((k) => k.endsWith(lockKey));
        const postReleaseValue = await redisClient.get(redisPrefixedKey);
        const postReleaseRawValue = await redisClient.get(lockKey);
        log("Post-release Redis key (" + redisPrefixedKey + "): " + postReleaseValue + ", lingering keys count: " + lingeringMatchingKeys.length);

        // 6. Capture database state immediately after workflow execution (FRESH QUERIES)
        log("Capturing fresh database snapshots immediately after workflow execution...");
        const cartDbAfterRes = await pgClient.query(
          "SELECT id, currency_code, created_at FROM cart WHERE id = $1",
          [cartId]
        );
        log("Fresh post-workflow Cart record: " + JSON.stringify(cartDbAfterRes.rows[0]));

        const dbAfterQuery = `SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = '${cartId}';`;
        const dbAfterRes = await pgClient.query(
          "SELECT cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at FROM cart_checkout_session WHERE cart_id = $1",
          [cartId]
        );
        dbAfterSnapshot = {
          capturedAt: new Date().toISOString(),
          query: dbAfterQuery,
          rows: dbAfterRes.rows,
          cartQuery: `SELECT id, currency_code, created_at FROM cart WHERE id = '${cartId}';`,
          cartRows: cartDbAfterRes.rows,
        };
        log("Post-workflow database snapshot captured (rows: " + dbAfterSnapshot.rows.length + ").");

        // 7. Compile before vs after state comparison
        const beforeRow = dbBeforeSnapshot.rows[0];
        const afterRow = dbAfterSnapshot.rows[0];
        const columns = ["cart_id", "current_attempt_id", "epoch", "status", "created_at", "updated_at", "deleted_at"];
        const observedPrefix = inFlightInspection?.prefix ?? null;

        const cartBefore = cartDbRes.rows[0];
        const cartAfter = cartDbAfterRes.rows[0];

        assertions = [
          // --- Group 1: Environment & Disposable Safety ---
          {
            name: "target_services_verified_disposable",
            expected: true,
            actual: disposableCheck?.verified === true,
            passed: disposableCheck?.verified === true,
            category: "safety",
            detail: `Verified PostgreSQL (${disposableCheck?.pgHost}:${disposableCheck?.pgPort}/${disposableCheck?.pgDatabase}) and Redis (${disposableCheck?.redisHost}:${disposableCheck?.redisPort}) are disposable loopback/test instances prior to any write operations`,
          },
          {
            name: "disposable_validator_self_checks_passed",
            expected: { total: validatorSelfCheck.total, passed: validatorSelfCheck.total, failed: 0 },
            actual: { total: validatorSelfCheck.total, passed: validatorSelfCheck.passed, failed: validatorSelfCheck.failed },
            passed: validatorSelfCheck.allPassed === true,
            category: "safety",
            detail: `Validator unit battery executed: ${validatorSelfCheck.passed}/${validatorSelfCheck.total} self-checks passed without security regressions`,
          },
          {
            name: "postgres_service_connected",
            expected: true,
            actual: Boolean(sessionTableCheckRes),
            passed: Boolean(sessionTableCheckRes),
            category: "infrastructure",
            detail: "Direct pgClient connected and queried information_schema",
          },
          {
            name: "redis_service_connected",
            expected: "PONG",
            actual: redisPing,
            passed: redisPing === "PONG",
            category: "infrastructure",
            detail: "Out-of-band Redis client PING returned PONG",
          },
          {
            name: "cart_checkout_session_table_present",
            expected: true,
            actual: sessionTablePresent,
            passed: sessionTablePresent === true,
            category: "schema",
            detail: "Verified cart_checkout_session table exists in public schema",
          },
          {
            name: "cart_table_present",
            expected: true,
            actual: cartTablePresent,
            passed: cartTablePresent === true,
            category: "schema",
            detail: "Verified canonical Medusa cart table exists in public schema",
          },
          {
            name: "fixture_no_raw_epoch_column_in_db",
            expected: false,
            actual: rawEpochColumnExistsInDb,
            passed: rawEpochColumnExistsInDb === false,
            category: "schema",
            detail: `Queried information_schema.columns for public.cart_checkout_session: physical columns = [${physicalColumnNames.join(", ")}]; raw_epoch column is absent`,
          },
          {
            name: "dml_model_declared_schema_epoch_is_number_without_raw_epoch",
            expected: { epochType: "number", rawEpochDeclared: false },
            actual: {
              epochType: CartCheckoutSession.schema?.epoch?.dataType?.name || null,
              rawEpochDeclared: "raw_epoch" in CartCheckoutSession.schema,
            },
            passed:
              CartCheckoutSession.schema?.epoch?.dataType?.name === "number" &&
              !("raw_epoch" in CartCheckoutSession.schema),
            category: "schema",
            detail: `Inspected CartCheckoutSession.schema: epoch dataType is 'number' and raw_epoch is not declared`,
          },

          // --- Group 2: Real Medusa Container & Provider Configuration ---
          {
            name: "real_medusa_container_booted",
            expected: true,
            actual: Boolean(container && typeof container.resolve === "function"),
            passed: Boolean(container && typeof container.resolve === "function"),
            category: "configuration",
            detail: "Loaded via @medusajs/medusa/loaders loaders.default from apps/backend/medusa-config.ts",
          },
          {
            name: "locking_module_resolved_from_container",
            expected: true,
            actual: Boolean(lockingService && typeof lockingService.acquire === "function"),
            passed: Boolean(lockingService && typeof lockingService.acquire === "function"),
            category: "configuration",
            detail: "Modules.LOCKING resolved directly from Medusa container with acquire/release methods",
          },
          {
            name: "batch_inventory_module_resolved_from_container",
            expected: true,
            actual: Boolean(batchInventoryService && typeof batchInventoryService.createCartCheckoutSessions === "function"),
            passed: Boolean(batchInventoryService && typeof batchInventoryService.createCartCheckoutSessions === "function"),
            category: "configuration",
            detail: "batch_inventory service resolved directly from Medusa container with DML methods",
          },
          {
            name: "cart_module_resolved_from_container",
            expected: true,
            actual: Boolean(cartService && typeof cartService.createCarts === "function"),
            passed: Boolean(cartService && typeof cartService.createCarts === "function"),
            category: "configuration",
            detail: "Modules.CART resolved directly from Medusa container with createCarts method",
          },
          {
            name: "locking_provider_entry_present_in_config",
            expected: true,
            actual: Boolean(configuredProviderEntry && configuredProviderEntry.id),
            passed: Boolean(configuredProviderEntry && configuredProviderEntry.id),
            category: "configuration",
            detail: `Loaded Medusa configuration contains locking provider entry (id: '${configDeclaredId}', resolve: '${configDeclaredResolve}')`,
          },
          {
            name: "locking_provider_configured_in_medusa_config",
            expected: configDeclaredId,
            actual: containerDefaultProviderId,
            passed: Boolean(configDeclaredId) && Boolean(containerDefaultProviderId) && configDeclaredId === containerDefaultProviderId,
            category: "configuration",
            detail: `Runtime comparison: medusa-config declared provider ID (${configDeclaredId}) matches container default provider ID (${containerDefaultProviderId})`,
          },
          {
            name: "locking_provider_resolve_path_matches_expected",
            expected: "./src/modules/locking-redis/index.mjs",
            actual: configDeclaredResolve,
            passed: configDeclaredResolve === "./src/modules/locking-redis/index.mjs",
            category: "configuration",
            detail: `Runtime comparison: medusa-config provider resolve path matches local safe redis locking provider`,
          },
          {
            name: "locking_provider_marked_is_default_in_config",
            expected: true,
            actual: configDeclaredIsDefault,
            passed: configDeclaredIsDefault === true,
            category: "configuration",
            detail: `Runtime comparison: medusa-config explicitly marks locking provider as is_default: true`,
          },
          {
            name: "locking_provider_instance_is_safe_redis",
            expected: "SafeRedisLockingProvider",
            actual: providerClassName,
            passed: providerClassName === "SafeRedisLockingProvider",
            category: "configuration",
            detail: `Runtime instance constructor: ${providerClassName} resolved via providerService_`,
          },
          {
            name: "redis_lock_key_prefix_matches_provider_config",
            expected: providerConfiguredPrefix,
            actual: observedPrefix,
            passed: Boolean(providerConfiguredPrefix) && Boolean(observedPrefix) && observedPrefix === providerConfiguredPrefix,
            category: "configuration",
            detail: `Runtime verification: Observed Redis physical key prefix (${observedPrefix}) equals provider configured prefix (${providerConfiguredPrefix})`,
          },

          // --- Group 3: Real Cart & Checkout Session Fixtures ---
          {
            name: "real_cart_created_via_medusa_service",
            expected: true,
            actual: Boolean(realCart && typeof realCart.id === "string" && realCart.id.startsWith("cart_")),
            passed: Boolean(realCart && typeof realCart.id === "string" && realCart.id.startsWith("cart_")),
            category: "fixture",
            detail: `Real Cart created via cartService.createCarts: ${realCart?.id}`,
          },
          {
            name: "real_cart_persisted_in_database",
            expected: 1,
            actual: cartDbRes.rows.length,
            passed: cartDbRes.rows.length === 1 && cartDbRes.rows[0]?.id === cartId,
            category: "fixture",
            detail: `Verified Cart ${cartId} is physically present in PostgreSQL table 'cart'`,
          },
          {
            name: "cart_checkout_session_linked_to_real_cart",
            expected: cartId,
            actual: rawSqlSession?.cart_id,
            passed: rawSqlSession?.cart_id === cartId,
            category: "fixture",
            detail: `cart_checkout_session.cart_id (${rawSqlSession?.cart_id}) references real Cart ID (${cartId})`,
          },
          {
            name: "fixture_created_via_module_service",
            expected: { cart_id: cartId, status: "in_progress", epoch: 1 },
            actual: {
              cart_id: createdSession?.cart_id,
              status: createdSession?.status,
              epoch: createdSession?.epoch,
            },
            passed:
              createdSession?.cart_id === cartId &&
              createdSession?.status === "in_progress" &&
              createdSession?.epoch === 1,
            category: "fixture",
            detail: "Created via BatchInventoryModuleService.createCartCheckoutSessions with model.number()",
          },
          {
            name: "fixture_retrieved_via_module_service",
            expected: { cart_id: cartId, current_attempt_id: attemptId, epoch: 1 },
            actual: {
              cart_id: retrievedServiceSession?.cart_id,
              current_attempt_id: retrievedServiceSession?.current_attempt_id,
              epoch: retrievedServiceSession?.epoch,
            },
            passed:
              retrievedServiceSession?.cart_id === cartId &&
              retrievedServiceSession?.current_attempt_id === attemptId &&
              retrievedServiceSession?.epoch === 1,
            category: "fixture",
            detail: "Retrieved via BatchInventoryModuleService.retrieveCartCheckoutSession",
          },
          {
            name: "fixture_retrieved_via_raw_sql",
            expected: { cart_id: cartId, current_attempt_id: attemptId, epoch: 1, status: "in_progress" },
            actual: {
              cart_id: rawSqlSession?.cart_id,
              current_attempt_id: rawSqlSession?.current_attempt_id,
              epoch: Number(rawSqlSession?.epoch),
              status: rawSqlSession?.status,
            },
            passed:
              rawSqlSession?.cart_id === cartId &&
              rawSqlSession?.current_attempt_id === attemptId &&
              Number(rawSqlSession?.epoch) === 1 &&
              rawSqlSession?.status === "in_progress",
            category: "fixture",
            detail: "Retrieved via raw pgClient.query",
          },
          {
            name: "fixture_service_and_sql_reconciled",
            expected: true,
            actual:
              retrievedServiceSession?.cart_id === rawSqlSession?.cart_id &&
              Number(retrievedServiceSession?.epoch) === Number(rawSqlSession?.epoch) &&
              retrievedServiceSession?.current_attempt_id === rawSqlSession?.current_attempt_id &&
              rawEpochColumnExistsInDb === false,
            passed:
              retrievedServiceSession?.cart_id === rawSqlSession?.cart_id &&
              Number(retrievedServiceSession?.epoch) === Number(rawSqlSession?.epoch) &&
              retrievedServiceSession?.current_attempt_id === rawSqlSession?.current_attempt_id &&
              rawEpochColumnExistsInDb === false,
            category: "fixture",
            detail: "DML service output reconciles with PostgreSQL physical table state (epoch integer, no raw_epoch)",
          },
          {
            name: "db_before_captured_after_fixture_validation",
            expected: 1,
            actual: dbBeforeSnapshot.rows.length,
            passed: dbBeforeSnapshot.rows.length === 1 && dbBeforeSnapshot.rows[0]?.cart_id === cartId,
            category: "evidence",
            detail: `Pre-workflow database snapshot captured immediately before workflow execution contains 1 validated fixture row for cart ${cartId}`,
          },

          // --- Group 4: Behavioral Locking Semantics (Runtime Observations) ---
          {
            name: "parent_lock_step_acquired",
            expected: true,
            actual: inFlightInspection?.exists === true,
            passed: inFlightInspection?.exists === true,
            category: "behavioral",
            detail: "Core-flows acquireLockStep successfully acquired lock via locking-redis provider",
          },
          {
            name: "redis_lock_key_present_in_flight",
            expected: true,
            actual: inFlightInspection?.exists === true,
            passed: inFlightInspection?.exists === true,
            category: "behavioral",
            detail: "In-flight inspection verified Redis key: " + inFlightInspection?.actualKey,
          },
          {
            name: "redis_lock_owner_match",
            expected: workerId,
            actual: inFlightInspection?.owner,
            passed: inFlightInspection?.owner === workerId,
            category: "behavioral",
            detail: "Out-of-band Redis GET verified owner string matches workerId",
          },
          {
            name: "redis_lock_ttl_within_window",
            expected: "> 110s and <= 120s",
            actual: inFlightInspection?.ttl,
            passed:
              typeof inFlightInspection?.ttl === "number" &&
              inFlightInspection.ttl > 110 &&
              inFlightInspection.ttl <= 120,
            category: "behavioral",
            detail: "Out-of-band Redis TTL verified within 110s-120s window",
          },
          {
            name: "nested_subworkflow_lock_skipped",
            expected: { executed: true, nestedLockAcquired: false },
            actual: {
              executed: nestedResult?.executed === true,
              nestedLockAcquired: Boolean(nestedResult?.nestedLock),
            },
            passed: nestedResult?.executed === true && !nestedResult?.nestedLock,
            category: "behavioral",
            detail:
              "Sub-workflow acquireLockStep recognized parentStepIdempotencyKey and skipped re-acquisition without mutating held lock",
          },
          {
            name: "release_lock_step_succeeded",
            expected: true,
            actual: releaseResult === true,
            passed: releaseResult === true,
            category: "behavioral",
            detail: "Core-flows releaseLockStep successfully released lock",
          },
          {
            name: "redis_lock_key_deleted_after_release",
            expected: false,
            actual: postReleaseKeyExists,
            passed: postReleaseKeyExists === false && postReleaseValue === null && postReleaseRawValue === null,
            category: "behavioral",
            detail: "Out-of-band Redis keys scan and GET verified lock key was deleted upon releaseLockStep",
          },

          // --- Group 5: Behavioral Database Invariants (Before vs After) ---
          {
            name: "cart_checkout_session_attempt_id_unaltered",
            expected: beforeRow?.current_attempt_id,
            actual: afterRow?.current_attempt_id,
            passed: Boolean(beforeRow && afterRow && beforeRow.current_attempt_id === afterRow.current_attempt_id),
            category: "behavioral",
            detail: `Verified cart_checkout_session.current_attempt_id unaltered: before=${beforeRow?.current_attempt_id}, after=${afterRow?.current_attempt_id}`,
          },
          {
            name: "cart_checkout_session_epoch_unaltered",
            expected: 1,
            actual: Number(afterRow?.epoch),
            passed: Number(beforeRow?.epoch) === 1 && Number(afterRow?.epoch) === 1,
            category: "behavioral",
            detail: "Verified cart_checkout_session.epoch remains integer 1 after workflow execution",
          },
          {
            name: "cart_checkout_session_status_unaltered",
            expected: "in_progress",
            actual: afterRow?.status,
            passed: beforeRow?.status === "in_progress" && afterRow?.status === "in_progress",
            category: "behavioral",
            detail: "Verified cart_checkout_session.status remains 'in_progress'",
          },
          {
            name: "cart_checkout_session_all_fields_unaltered",
            expected: {
              cart_id: true,
              current_attempt_id: true,
              epoch: true,
              status: true,
              created_at: true,
              updated_at: true,
              deleted_at: true,
            },
            actual: {
              cart_id: beforeRow?.cart_id === afterRow?.cart_id,
              current_attempt_id: beforeRow?.current_attempt_id === afterRow?.current_attempt_id,
              epoch: Number(beforeRow?.epoch) === Number(afterRow?.epoch),
              status: beforeRow?.status === afterRow?.status,
              created_at:
                beforeRow?.created_at && afterRow?.created_at
                  ? new Date(beforeRow.created_at).toISOString() === new Date(afterRow.created_at).toISOString()
                  : false,
              updated_at:
                beforeRow?.updated_at && afterRow?.updated_at
                  ? new Date(beforeRow.updated_at).toISOString() === new Date(afterRow.updated_at).toISOString()
                  : false,
              deleted_at: beforeRow?.deleted_at === afterRow?.deleted_at,
            },
            passed: Boolean(
              beforeRow &&
              afterRow &&
              beforeRow.cart_id === afterRow.cart_id &&
              beforeRow.current_attempt_id === afterRow.current_attempt_id &&
              Number(beforeRow.epoch) === Number(afterRow.epoch) &&
              beforeRow.status === afterRow.status &&
              beforeRow.created_at && afterRow.created_at &&
              new Date(beforeRow.created_at).toISOString() === new Date(afterRow.created_at).toISOString() &&
              beforeRow.updated_at && afterRow.updated_at &&
              new Date(beforeRow.updated_at).toISOString() === new Date(afterRow.updated_at).toISOString() &&
              beforeRow.deleted_at === afterRow.deleted_at
            ),
            category: "behavioral",
            detail: "Verified all 7 cart_checkout_session fields (cart_id, current_attempt_id, epoch, status, created_at, updated_at, deleted_at) match exactly before and after workflow execution",
          },
          {
            name: "real_cart_all_fields_unaltered_after_workflow",
            expected: {
              id: true,
              currency_code: true,
              created_at: true,
            },
            actual: {
              id: cartBefore?.id === cartAfter?.id,
              currency_code: cartBefore?.currency_code === cartAfter?.currency_code,
              created_at:
                cartBefore?.created_at && cartAfter?.created_at
                  ? new Date(cartBefore.created_at).toISOString() === new Date(cartAfter.created_at).toISOString()
                  : false,
            },
            passed: Boolean(
              cartBefore &&
              cartAfter &&
              cartBefore.id === cartAfter.id &&
              cartBefore.currency_code === cartAfter.currency_code &&
              cartBefore.created_at && cartAfter.created_at &&
              new Date(cartBefore.created_at).toISOString() === new Date(cartAfter.created_at).toISOString()
            ),
            category: "behavioral",
            detail: "Verified fresh post-workflow Cart query matches pre-workflow Cart record across id, currency_code, and created_at timestamp",
          },
        ];

        // Format db-before.sql and db-after.sql
        let fixtureSqlText = "";
        if (capturedFixtureSql.length > 0) {
          fixtureSqlText =
            "-- Captured SQL statements executed by database client during fixture creation:\n" +
            capturedFixtureSql
              .map((stmt, idx) => `-- [Statement ${idx + 1}]\n${stmt.text};\n-- Parameters: ${JSON.stringify(stmt.values)}`)
              .join("\n\n");
        } else {
          fixtureSqlText =
            "-- [Illustrative equivalent]:\n" +
            `-- INSERT INTO "cart" ("id", "currency_code", "created_at", "updated_at") VALUES ('${cartId}', 'usd', NOW(), NOW());\n` +
            `-- INSERT INTO "cart_checkout_session" ("cart_id", "current_attempt_id", "epoch", "status", "created_at", "updated_at") VALUES ('${cartId}', '${attemptId}', 1, 'in_progress', NOW(), NOW());`;
        }

        dbQueries = {
          before:
            "-- ============================================================================\n" +
            "-- TP-02a DB Snapshot: Immediately Before Workflow Execution (After Fixtures)\n" +
            "-- Captured at: " + dbBeforeSnapshot.capturedAt + "\n" +
            "-- ============================================================================\n\n" +
            "-- Query 1: Verify real Cart fixture\n" +
            `SELECT id, currency_code, created_at FROM cart WHERE id = '${cartId}';\n\n` +
            "-- Result:\n" +
            formatSqlTable(cartDbRes.rows, ["id", "currency_code", "created_at"]) + "\n" +
            "-- Query 2: Check cart_checkout_session before workflow execution\n" +
            dbBeforeQuery + "\n\n" +
            "-- Result:\n" +
            formatSqlTable(dbBeforeSnapshot.rows, columns) + "\n" +
            fixtureSqlText + "\n",
          after:
            "-- ============================================================================\n" +
            "-- TP-02a DB Snapshot: Immediately After Workflow Execution\n" +
            "-- Captured at: " + dbAfterSnapshot.capturedAt + "\n" +
            "-- ============================================================================\n\n" +
            "-- Query 1: Verify real Cart fixture after workflow (FRESH QUERY)\n" +
            `SELECT id, currency_code, created_at FROM cart WHERE id = '${cartId}';\n\n` +
            "-- Result:\n" +
            formatSqlTable(cartDbAfterRes.rows, ["id", "currency_code", "created_at"]) + "\n" +
            "-- Query 2: Check cart_checkout_session state after workflow execution\n" +
            dbAfterQuery + "\n\n" +
            "-- Result:\n" +
            formatSqlTable(dbAfterSnapshot.rows, columns) + "\n",
        };
      }
    }
  } catch (error) {
    caughtException = error;
    logErr("UNCAUGHT EXCEPTION during TP-02a: " + (error?.stack || String(error)));
  } finally {
    // Guarnateed safe cleanup for test-owned database fixtures and Redis keys
    if (createdCartId && pgClient) {
      try {
        log("Cleaning up test cart_checkout_session fixture: " + createdCartId + "...");
        await pgClient.query("DELETE FROM cart_checkout_session WHERE cart_id = $1;", [createdCartId]);
        log("Cleaned up test cart_checkout_session.");
      } catch (cleanErr) {
        logErr("Cleanup error (cart_checkout_session): " + cleanErr.message);
        cleanupErrors.push("cart_checkout_session: " + cleanErr.message);
      }
      try {
        log("Cleaning up test cart fixture: " + createdCartId + "...");
        await pgClient.query("DELETE FROM cart WHERE id = $1;", [createdCartId]);
        log("Cleaned up test cart.");
      } catch (cleanErr) {
        logErr("Cleanup error (cart): " + cleanErr.message);
        cleanupErrors.push("cart: " + cleanErr.message);
      }
    }

    if (redisClient && (createdRedisPrefixedKey || createdLockKey)) {
      try {
        if (createdRedisPrefixedKey) {
          log("Cleaning up test Redis keys: " + createdRedisPrefixedKey + "...");
          await redisClient.del(createdRedisPrefixedKey);
        }
        if (createdLockKey) {
          await redisClient.del(createdLockKey);
        }
        log("Cleaned up test Redis keys.");
      } catch (cleanErr) {
        logErr("Cleanup error (redis): " + cleanErr.message);
        cleanupErrors.push("redis: " + cleanErr.message);
      }
    }

    try {
      if (redisClient && redisClient.status !== "end") {
        log("Closing direct out-of-band Redis client...");
        redisClient.disconnect();
      }
    } catch (cleanErr) {
      logErr("Cleanup warning (redis disconnect): " + cleanErr.message);
    }

    try {
      if (pgClient) {
        log("Closing direct PostgreSQL inspection client...");
        await pgClient.end();
      }
    } catch (cleanErr) {
      logErr("Cleanup warning (pg disconnect): " + cleanErr.message);
    }
  }

  // Finalize lifecycle state AFTER cleanup completes
  const cleanupSucceeded = cleanupErrors.length === 0;
  if (createdCartId || createdRedisPrefixedKey) {
    assertions.push({
      name: "test_fixture_cleanup_succeeded",
      expected: true,
      actual: cleanupSucceeded,
      passed: cleanupSucceeded,
      category: "lifecycle",
      detail: cleanupSucceeded
        ? "All test fixtures (cart, cart_checkout_session) and Redis keys were cleaned up and connections closed successfully."
        : "Cleanup failed: " + cleanupErrors.join("; "),
    });
  }

  if (caughtException) {
    assertions.push({
      name: "uncaught_exception_free_execution",
      expected: true,
      actual: false,
      passed: false,
      category: "reliability",
      detail: caughtException.message || String(caughtException),
    });
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
  log(`TP-02a Assertion Summary: ${assertions.length - failedAssertions.length}/${assertions.length} passed.`);
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
    log("SUCCESS: TP-02a executed and all assertions passed. Evidence written to artifacts/tp-evidence/TP-02a/");
  } else {
    logErr(`FAIL: TP-02a status is '${testStatus}' (exitCode=${exitCode}).`);
  }

  return exitCode;
}

// Top-level entrypoint: run test to completion, ensure cleanup executes, then exit with returned code
const finalExitCode = await runTp02aTest();
process.exit(finalExitCode);

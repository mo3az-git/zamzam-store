import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const implementationPlanPath = path.join(root, "docs", "implementation-plan.md");
// A prerequisite scan must never impersonate or overwrite a behavioral run.
const evidenceRoot = path.join(root, "artifacts", "tp-readiness");
const runnableBoundaries = {
  "TP-02a": "Real Medusa distributed lock workflow runner exists; behavioral execution and independent review are separate.",
  "TP-02b": "Real-service heartbeat worker runner exists; HTTP checkout integration is absent.",
  "TP-02c": "Original real-service lease CAS workflow assertions plus real prototype checkout-lock HTTP 409 are exercised; full commerce checkout is absent.",
  "TP-03": "Original real-service lock contention assertions plus real prototype checkout-lock HTTP 409 are exercised; inventory count remains table-wide on an empty cart.",
  "TP-04a": "Real native Store API mutation guard and disposable HTTP runner exist.",
  "TP-04b": "Native HTTP guard rejects stale in-progress sessions; the recovery-controller protocol remains unimplemented and is not claimed by the aborted-state fixture control.",
  "TP-06a": "Real Medusa cart and product modules reserve multi-line quantities against PostgreSQL batch rows using Cairo-date FEFO and append-only movement snapshots; TP-01 remains unexecuted.",
  "TP-06b": "Real PostgreSQL runner covers replay, intent conflict, divergence, injected transaction rollback, and backend-observed batch contention; it does not implement order conversion.",
  "TP-07a": "Real PostgreSQL runner covers expired reservation release, immutable movement consistency, retry, and concurrent cleanup; order-aware recovery remains outside this boundary.",
  "TP-07b": "Real PostgreSQL two-transaction schedules prove order-root lock ordering across cleanup and conversion; converted reservations are preserved and cleanup only skips them after conversion commits.",
  "TP-09": "Native order/cart association and order-line metadata map checkout_line_key deterministically; exact reservation-set validation rejects missing, duplicate, released, or ambiguous mappings.",
  "TP-10": "One checkout line may allocate across multiple FEFO batches; allocations and zero-delta conversion movements are atomic, replay-safe, and rollback together on injected failure.",
  "TP-24c": "Real Medusa app-role privilege denial and separate non-owner trigger rejection run against an isolated PostgreSQL database; no production roles are changed.",
  "TP-21c": "Real Medusa system_security refund fingerprint/hash/encryption component and real-service harness exist; refund persistence and payout behavior remain absent.",
};
const customTables = [
  "cart_batch_reservation", "cart_checkout_session", "cart_checkout_attempt",
  "idempotency_key", "inventory_batch", "inventory_movement",
  "order_batch_allocation", "shipping_delivery_zone",
  "guest_order_session", "cod_collection_record", "electronic_payment_attempt",
  "refund_record", "return_request", "refund_attempt",
  "payment_webhook_event", "cart_checkout_epoch"
];
const groups = {
  A: new Set(["TP-01", "TP-02a", "TP-03"]),
  B: new Set(["TP-02b", "TP-02c", "TP-04a", "TP-04b", "TP-05", "TP-12a", "TP-12b", "TP-12c", "TP-14a", "TP-14b"]),
  C: new Set(["TP-06a", "TP-06b", "TP-07a", "TP-07b", "TP-09", "TP-10", "TP-23e", "TP-24a", "TP-24c"]),
  D: new Set(["TP-08a", "TP-08b", "TP-11", "TP-13a", "TP-13b", "TP-13c", "TP-13d", "TP-13e", "TP-13f", "TP-13g", "TP-15a", "TP-15b", "TP-15c"]),
  E: new Set(["TP-16", "TP-17", "TP-18", "TP-19", "TP-20a", "TP-20b"]),
  F: new Set(["TP-21a", "TP-21b", "TP-21c", "TP-21d", "TP-21e", "TP-21f", "TP-22a", "TP-22b", "TP-23a", "TP-23b", "TP-23c", "TP-23d", "TP-23f"]),
  G: new Set(["TP-25a", "TP-25b", "TP-25c", "TP-25d", "TP-24b"])
};
const requiredTokensById = {
  "TP-01": ["checkout_line_key", "cart"],
  "TP-02a": ["acquireLockStep"],
  "TP-03": ["LockTimeoutError", "cart_checkout_session"],
  "TP-02b": ["last_heartbeat_at", "extendLock"],
  "TP-02c": ["lease_owner_id", "idempotency_key"],
  "TP-04a": ["cartMutationGuard", "cart_checkout_session", "in_progress"],
  "TP-04b": ["cartMutationGuard", "cart_checkout_session", "in_progress"],
  "TP-05": ["electronic_payment_attempt", "cod_collection_record"],
  "TP-06a": ["cart_batch_reservation", "inventory_movement"],
  "TP-06b": ["cart_batch_reservation", "inventory_movement"],
  "TP-07a": ["inventory_batch", "inventory_movement"],
  "TP-07b": ["inventory_batch", "inventory_movement"],
  "TP-09": ["inventory_movement"],
  "TP-10": ["inventory_movement"],
  "TP-16": ["shipping_delivery_zone"],
  "TP-17": ["shipping_delivery_zone"],
  "TP-18": ["shipping_delivery_zone"],
  "TP-19": ["shipping_delivery_zone"],
  "TP-20a": ["guest_order_session"],
  "TP-20b": ["guest_order_session"],
  "TP-21a": ["refund_record"],
  "TP-21b": ["refund_record"],
  "TP-21c": ["recipient_fingerprint"],
  "TP-21d": ["refund_record", "refund_attempt"],
  "TP-21e": ["approved_by", "reconciled_by"],
  "TP-21f": ["external_reference"],
  "TP-22a": ["refund_record"],
  "TP-22b": ["refund_record"],
  "TP-23a": ["return_request", "return_item"],
  "TP-23b": ["return_request", "return_item"],
  "TP-23c": ["return_request", "refund_record"],
  "TP-23d": ["return_item"],
  "TP-23e": ["order_batch_allocation", "inventory_movement"],
  "TP-23f": ["return_request", "return_item"],
  "TP-24a": ["inventory_batch", "inventory_movement"],
  "TP-24b": ["cod_collection_record", "electronic_payment_attempt"],
  "TP-24c": ["inventory_movement"],
  "TP-25a": ["electronic_payment_attempt"],
  "TP-25b": ["payment_webhook_event"],
  "TP-25c": ["electronic_payment_attempt", "cart_checkout_attempt"],
  "TP-25d": ["refund_record", "refund_attempt"]
};
const defaultTokens = {
  B: ["cart_checkout_session", "idempotency_key"],
  C: ["inventory_batch", "inventory_movement"],
  D: ["cart_checkout_attempt", "order_batch_allocation"],
  E: ["shipping_delivery_zone", "guest_order_session"],
  F: ["return_request", "refund_record"],
  G: ["electronic_payment_attempt", "payment_webhook_event"]
};
function groupFor(id) {
  for (const [group, ids] of Object.entries(groups)) if (ids.has(id)) return group;
  return null;
}
function safeJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}
async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const results = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".medusa" || entry.name === "dist") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}
function captureVersion(command, args) {
  try { return execFileSync(command, args, { encoding: "utf8" }).trim(); }
  catch { return "unavailable"; }
}
const startedAt = new Date().toISOString();
const nodeVersion = process.version;
const npmVersion = captureVersion("npm", ["--version"]);
const commitSha = process.env.GITHUB_SHA || "local-uncommitted";
const lockPath = path.join(root, "package-lock.json");
let lockSha256 = null;
try { lockSha256 = createHash("sha256").update(await readFile(lockPath)).digest("hex"); }
catch { /* package-lock absence is recorded as missing evidence, not as a pass */ }

const sourceRoot = path.join(root, "apps", "backend", "src");
const sourceFiles = (await walk(sourceRoot)).sort();
const sourceContents = [];
for (const file of sourceFiles) {
  sourceContents.push({ path: path.relative(root, file).split(path.sep).join("/"), content: await readFile(file, "utf8") });
}
const combinedSource = sourceContents.map((entry) => entry.content).join("\n");
const sourceInventory = {
  files: sourceContents.map((entry) => entry.path),
  customApiFiles: sourceContents.filter((entry) => entry.path.startsWith("apps/backend/src/api/")).map((entry) => entry.path),
  workflowFiles: sourceContents.filter((entry) => entry.path.startsWith("apps/backend/src/workflows/")).map((entry) => entry.path),
  migrationFiles: sourceContents.filter((entry) => /(^|\/)(migrations?|migration-scripts?)(\/|$)/i.test(entry.path)).map((entry) => entry.path),
  sourceTextHasCustomCheckoutLineKey: combinedSource.includes("checkout_line_key"),
  sourceTextHasAcquireLockStep: combinedSource.includes("acquireLockStep"),
  sourceTextHasCustomInventoryMovement: combinedSource.includes("inventory_movement"),
  sourceTextHasPaymentWebhookEvent: combinedSource.includes("payment_webhook_event"),
  assessmentOnly: true
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for read-only database schema evidence.");
const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
await db.connect();
async function snapshot(label) {
  const query = "SELECT table_schema, table_name FROM information_schema.tables " +
    "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE' " +
    "ORDER BY table_schema, table_name";
  const result = await db.query(query);
  const tableNames = result.rows.map((row) => row.table_name);
  return {
    label,
    capturedAt: new Date().toISOString(),
    query,
    totalApplicationTables: result.rows.length,
    tables: result.rows,
    expectedDomainTables: customTables.map((tableName) => ({
      tableName,
      present: tableNames.includes(tableName)
    }))
  };
}
const dbBefore = await snapshot("before-preflight-assessment");
const plan = await readFile(implementationPlanPath, "utf8");
const rows = plan.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\|\s*\*\*TP-\d+[a-z]?\*\*/.test(line));
const idPattern = /^\|\s*\*\*(TP-\d+[a-z]?)\*\*/;
if (rows.length !== 59) throw new Error("Expected 59 TP rows; found " + rows.length + ".");
const parsed = rows.map((row) => {
  const id = row.match(idPattern)?.[1];
  const cells = row.split("|").map((cell) => cell.trim());
  const title = (cells[2] || "Untitled TP").replace(/^\*\*|\*\*$/g, "");
  const group = groupFor(id);
  if (!group) throw new Error("No execution group mapping found for " + id + ".");
  return { id, title, group, rawRow: row };
});
const allMapped = Object.values(groups).reduce((sum, set) => sum + set.size, 0);
if (allMapped !== 59 || new Set(parsed.map((item) => item.id)).size !== 59) {
  throw new Error("Execution group mapping must cover 59 unique TP cases; mapped=" + allMapped + ".");
}
const dbAfter = await snapshot("after-preflight-assessment");
await db.end();

const dbQuery = "SELECT table_schema, table_name FROM information_schema.tables WHERE " +
  "table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE' " +
  "ORDER BY table_schema, table_name;\n";
const runnableCount = parsed.filter((item) => Object.hasOwn(runnableBoundaries, item.id) &&
  (requiredTokensById[item.id] || []).every((token) => combinedSource.includes(token))).length;
const summary = {
  assessmentType: "readiness-only; no TP behavior was executed or simulated",
  commitSha,
  startedAt,
  completedAt: new Date().toISOString(),
  casesInRegistry: parsed.length,
  behavioralTestsExecuted: 0,
  passed: 0,
  failed: 0,
  blocked: parsed.length - runnableCount,
  notExecuted: runnableCount,
  packageLockSha256: lockSha256,
  nodeVersion,
  npmVersion,
  postgresImageRef: process.env.PHASE1_POSTGRES_IMAGE_REF || "unspecified",
  redisImageRef: process.env.PHASE1_REDIS_IMAGE_REF || "unspecified",
  sourceInventory,
  databaseSnapshot: {
    totalApplicationTables: dbBefore.totalApplicationTables,
    customDomainTablesPresent: dbBefore.expectedDomainTables.filter((item) => item.present).map((item) => item.tableName),
    customDomainTablesAbsent: dbBefore.expectedDomainTables.filter((item) => !item.present).map((item) => item.tableName)
  },
  policy: "Missing prerequisites are blocked, never passed. Adapter-only tests do not satisfy end-to-end TP criteria."
};
await mkdir(evidenceRoot, { recursive: true });
await writeFile(path.join(root, "artifacts", "tp-readiness-summary.json"), safeJson(summary));

for (const item of parsed) {
  const capabilityTokens = requiredTokensById[item.id] || defaultTokens[item.group] || [];
  const missingTokens = capabilityTokens.filter((token) => !combinedSource.includes(token));
  const groupHasApplicationWorkflow = sourceInventory.customApiFiles.length > 0 ||
    sourceInventory.workflowFiles.length > 0 || sourceInventory.migrationFiles.length > 0;
  const runnable = Object.hasOwn(runnableBoundaries, item.id) && missingTokens.length === 0;
  const readinessStatus = runnable ? "not_executed" : "blocked";
  const reason = item.id === "TP-01"
    ? "Execution explicitly unauthorized. No line-key hook or batch-variant HTTP fixture exists. This scan neither creates fixtures nor executes TP-01."
    : runnableBoundaries[item.id] ||
      "The full behavior for this case is not implemented. " +
      (missingTokens.length ? "Missing source capabilities: " + missingTokens.join(", ") + ". " : "Shared primitives exist but do not establish the required route/workflow behavior. ") +
      "See docs/phase1-tp-case-matrix.md for the per-case dependency and next action.";
  const caseDir = path.join(evidenceRoot, item.id);
  await mkdir(caseDir, { recursive: true });
  const observedAt = new Date().toISOString();
  const assertions = [
    {
      name: "required_real_implementation_available",
      expected: true,
      actual: runnable,
      passed: runnable,
      detail: reason
    },
    {
      name: "required_capability_tokens_present_in_backend_source",
      expected: capabilityTokens,
      actual: capabilityTokens.filter((token) => combinedSource.includes(token)),
      passed: missingTokens.length === 0,
      missing: missingTokens
    },
    {
      name: "behavioral_test_executed",
      expected: true,
      actual: false,
      passed: false,
      detail: "This run is a prerequisite assessment only; no mock or substitute was used."
    },
    {
      name: "status_not_misreported_as_pass",
      expected: "blocked or not_executed",
      actual: readinessStatus,
      passed: true
    }
  ];
  const result = {
    schemaVersion: 1,
    tpId: item.id,
    title: item.title,
    batch: item.group,
    status: readinessStatus,
    assessmentType: "readiness-only; behavioral test not executed",
    startedAt: observedAt,
    endedAt: new Date().toISOString(),
    commitSha,
    nodeVersion,
    npmVersion,
    packageLockSha256: lockSha256,
    databaseImageRef: process.env.PHASE1_POSTGRES_IMAGE_REF || "unspecified",
    redisImageRef: process.env.PHASE1_REDIS_IMAGE_REF || "unspecified",
    testCommand: "npm run spike:tp-readiness",
    processExitCode: 0,
    behavioralTestExitCode: null,
    behavioralTestExecuted: false,
    blocker: reason,
    missingCapabilities: missingTokens,
    customApiFilesPresent: sourceInventory.customApiFiles.length > 0,
    workflowFilesPresent: sourceInventory.workflowFiles.length > 0,
    migrationFilesPresent: sourceInventory.migrationFiles.length > 0,
    dbBefore: "db-before.json",
    dbAfter: "db-after.json",
    note: "Exit code 0 means the readiness assessment completed successfully. It does not mean the TP passed."
  };
  const stdout = readinessStatus.toUpperCase() + " " + item.id + " [" + item.group + "]: " + reason + "\n";
  await writeFile(path.join(caseDir, "result.json"), safeJson(result));
  await writeFile(path.join(caseDir, "assertions.json"), safeJson(assertions));
  await writeFile(path.join(caseDir, "implementation-check.json"), safeJson({
    sourceInventory,
    capabilityTokens,
    missingTokens,
    groupHasApplicationWorkflow,
    existingDomainTables: dbBefore.expectedDomainTables.filter((table) => table.present).map((table) => table.tableName),
    absentDomainTables: dbBefore.expectedDomainTables.filter((table) => !table.present).map((table) => table.tableName),
    testExecuted: false
  }));
  await writeFile(path.join(caseDir, "stdout.log"), stdout);
  await writeFile(path.join(caseDir, "stderr.log"), "");
  await writeFile(path.join(caseDir, "db-before.json"), safeJson(dbBefore));
  await writeFile(path.join(caseDir, "db-after.json"), safeJson(dbAfter));
  await writeFile(path.join(caseDir, "db-before.sql"), "-- Read-only schema inventory query; no TP mutation executed.\n" + dbQuery);
  await writeFile(path.join(caseDir, "db-after.sql"), "-- Read-only schema inventory query; no TP mutation executed.\n" + dbQuery);
  console.log(stdout.trim());
}

const checkHDir = path.join(evidenceRoot, "CHECK-H");
const committedLockHash = createHash("sha256").update(execFileSync("git", ["show", "HEAD:package-lock.json"], { maxBuffer: 16 * 1024 * 1024 })).digest("hex");
await mkdir(checkHDir, { recursive: true });
const checkH = {
  schemaVersion: 1,
  id: "CHECK-H",
  title: "Compatibility evidence boundary",
  status: "supporting-evidence",
  assessmentType: "not a TP behavioral acceptance",
  commitSha,
  capturedAt: new Date().toISOString(),
  nodeVersion,
  npmVersion,
  packageLockSha256: lockSha256,
  databaseImageRef: process.env.PHASE1_POSTGRES_IMAGE_REF || "unspecified",
  redisImageRef: process.env.PHASE1_REDIS_IMAGE_REF || "unspecified",
  loaderDiagnosticLog: "artifacts/medusa-loader-diagnostic.log",
  installLog: "artifacts/npm-install.log",
  migrationLog: "artifacts/medusa-db-migrate.log",
  backendBuildLog: "artifacts/medusa-build.log",
  storefrontBuildLog: "artifacts/next-build.log",
  redisRegressionLog: "artifacts/locking-redis-regression.log",
  reviewBoundary: "Clean-install/build/migration evidence supports compatibility but does not pass any of the 59 TP rows. The lockfile is committed; compare its bytes with the tested checkout."
};
await writeFile(path.join(checkHDir, "result.json"), safeJson(checkH));
await writeFile(path.join(checkHDir, "stdout.log"), "SUPPORTING EVIDENCE CHECK-H: compatibility logs recorded; independent review remains required.\n");
await writeFile(path.join(checkHDir, "stderr.log"), "");
await writeFile(path.join(checkHDir, "assertions.json"), safeJson([
  { name: "package_lock_matches_committed_bytes", expected: committedLockHash, actual: lockSha256, passed: committedLockHash === lockSha256 }
]));
await writeFile(path.join(checkHDir, "db-before.json"), safeJson(dbBefore));
await writeFile(path.join(checkHDir, "db-after.json"), safeJson(dbAfter));
await writeFile(path.join(checkHDir, "db-before.sql"), "-- Read-only schema inventory query; no TP mutation executed.\n" + dbQuery);
await writeFile(path.join(checkHDir, "db-after.sql"), "-- Read-only schema inventory query; no TP mutation executed.\n" + dbQuery);

console.log("");
console.log("TP readiness assessment completed: " + parsed.length + " cases found, 0 behavioral tests executed. Readiness files are separate from behavioral evidence; consult each case's status and implementation inventory.");
console.log("No TP status in docs/implementation-plan.md was changed.");

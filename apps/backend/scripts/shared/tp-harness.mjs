import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  verifyDisposableTargetServices,
  runDisposableValidatorSelfChecks,
} from "../verify-disposable-target.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const backendRoot = path.resolve(__dirname, "../..");
export const repositoryRoot = path.resolve(backendRoot, "../..");

export { verifyDisposableTargetServices, runDisposableValidatorSelfChecks };

export function registerTsNode() {
  const rootRequire = createRequire(path.join(repositoryRoot, "package.json"));
  rootRequire("ts-node").register({
    project: path.join(backendRoot, "tsconfig.json"),
    transpileOnly: true,
  });
  return rootRequire;
}

export function captureVersion(cmd, args) {
  try {
    if (cmd === "npm") {
      const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      if (existsSync(cli)) return execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" }).trim();
    }
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

export function formatSqlTable(rows, columns) {
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

export async function getSystemMetadata() {
  const commitSha = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const nodeVersion = process.version;
  const npmVersion = captureVersion("npm", ["--version"]);
  let packageLockSha256 = null;
  try {
    const lockContent = await readFile(path.join(repositoryRoot, "package-lock.json"));
    packageLockSha256 = createHash("sha256").update(lockContent).digest("hex");
  } catch {
    // lockfile absence recorded as null
  }
  return { commitSha, nodeVersion, npmVersion, packageLockSha256 };
}

export async function loadMedusaRuntime({ entryPoints = false } = {}) {
  const originalCwd = process.cwd();
  if (process.cwd() !== backendRoot) {
    process.chdir(backendRoot);
  }
  process.env.MEDUSA_WORKER_MODE = "server";

  const medusaLoadersModule = await import("@medusajs/medusa/loaders/index");
  const loaders = medusaLoadersModule.default?.default || medusaLoadersModule.default || medusaLoadersModule;
  const express = (await import("express")).default;
  const expressApp = express();

  const runtime = await loaders({
    directory: backendRoot,
    expressApp,
    skipLoadingEntryPoints: !entryPoints,
  });

  if (process.cwd() !== originalCwd) {
    process.chdir(originalCwd);
  }

  return runtime;
}

export async function loadMedusaContainer() {
  return (await loadMedusaRuntime()).container;
}

export function createPgClient(databaseUrl, options = {}) {
  const require = createRequire(import.meta.url);
  const { Client: PgClient } = require("pg");
  return new PgClient({
    connectionString: databaseUrl,
    connectionTimeoutMillis: options.connectionTimeoutMillis || 5000,
    ...options,
  });
}

export function createRedisClient(redisUrl, options = {}) {
  const require = createRequire(import.meta.url);
  const RedisModule = require("ioredis");
  const Redis = RedisModule.default ?? RedisModule;
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    ...options,
  });
  client.on("error", () => {});
  return client;
}

export async function cleanupRedisLockKey(redisClient, key, ownerId, { log, logErr, cleanupErrors } = {}) {
  if (!redisClient || !key || !ownerId) return;
  try {
    if (log) log("Cleaning up test Redis lock key (owner-checked): " + key + "...");
    const ownerCheckDelScript = `
      local current = redis.call('get', KEYS[1])
      if not current then
        return 0
      elseif current == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return -1
      end
    `;
    const delResult = await redisClient.eval(ownerCheckDelScript, 1, key, ownerId);
    if (delResult === -1) {
      const foreignOwner = await redisClient.get(key);
      const msg = `Redis lock key '${key}' is owned by another worker ('${foreignOwner}'), refusing deletion.`;
      if (logErr) logErr("Cleanup error (redis): " + msg);
      if (cleanupErrors) cleanupErrors.push("redis: " + msg);
    } else if (delResult === 1) {
      if (log) log("Cleaned up lingering test Redis lock key (deleted with matching owner: " + ownerId + ").");
    } else {
      if (log) log("Test Redis lock key already released/absent; no deletion needed.");
    }
  } catch (cleanErr) {
    if (logErr) logErr("Cleanup error (redis): " + cleanErr.message);
    if (cleanupErrors) cleanupErrors.push("redis: " + cleanErr.message);
  }
}

export async function safeCloseClients({ pgClient, redisClient, log, logErr, cleanupErrors } = {}) {
  try {
    if (redisClient && redisClient.status !== "end") {
      if (log) log("Closing direct out-of-band Redis client...");
      redisClient.disconnect();
    }
  } catch (cleanErr) {
    if (logErr) logErr("Cleanup error (redis disconnect): " + cleanErr.message);
    if (cleanupErrors) cleanupErrors.push("redis disconnect: " + cleanErr.message);
  }

  try {
    if (pgClient) {
      if (log) log("Closing direct PostgreSQL inspection client...");
      await pgClient.end();
    }
  } catch (cleanErr) {
    if (logErr) logErr("Cleanup error (pg disconnect): " + cleanErr.message);
    if (cleanupErrors) cleanupErrors.push("pg disconnect: " + cleanErr.message);
  }
}

export async function writeTpEvidence({
  evidenceDir,
  tpId,
  title,
  batch = "A",
  status,
  assessmentType,
  blocker = null,
  assertions = [],
  exitCode = 0,
  dbBefore = null,
  dbAfter = null,
  dbQueries = null,
  containerDetails = null,
  startedAt,
  endedAt = new Date().toISOString(),
  commitSha,
  nodeVersion = process.version,
  npmVersion,
  packageLockSha256 = null,
  databaseImageRef,
  redisImageRef,
  testCommand,
  note = null,
  logLines = [],
  errLines = [],
  interleaving = null,
}) {
  await mkdir(evidenceDir, { recursive: true });

  const result = {
    schemaVersion: 1,
    tpId,
    title,
    batch,
    status,
    assessmentType: assessmentType || (status === "passed" ? "behavioral acceptance test" : "readiness check"),
    startedAt,
    endedAt,
    commitSha: commitSha || process.env.GITHUB_SHA || "local-head",
    nodeVersion,
    npmVersion: npmVersion || captureVersion("npm", ["--version"]),
    packageLockSha256,
    databaseImageRef:
      databaseImageRef ||
      process.env.PHASE1_POSTGRES_IMAGE_REF ||
      "postgres:16.15@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54",
    redisImageRef:
      redisImageRef ||
      process.env.PHASE1_REDIS_IMAGE_REF ||
      "redis:7.2.16@sha256:1009f15ccd9ed271996d1c65745a1ab1dadedea188feb3f1ab938602a32e50a3",
    testCommand,
    processExitCode: exitCode,
    behavioralTestExitCode: status === "blocked" ? null : exitCode,
    behavioralTestExecuted: status !== "blocked",
    blocker: blocker || null,
    dbBefore: "db-before.json",
    dbAfter: "db-after.json",
    containerDetails: containerDetails || null,
    note,
    sourceWorkingTreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: repositoryRoot, encoding: "utf8" }).trim().length > 0,
  };

  await writeFile(path.join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "assertions.json"), JSON.stringify(assertions, null, 2) + "\n");
  if (interleaving) {
    await writeFile(path.join(evidenceDir, "interleaving.json"), JSON.stringify(interleaving, null, 2) + "\n");
  }
  await writeFile(path.join(evidenceDir, "stdout.log"), logLines.join("\n") + "\n");
  await writeFile(path.join(evidenceDir, "stderr.log"), errLines.join("\n") + (errLines.length ? "\n" : ""));
  await writeFile(path.join(evidenceDir, "dbBefore.json"), JSON.stringify(dbBefore || {}, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "dbAfter.json"), JSON.stringify(dbAfter || {}, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "db-before.json"), JSON.stringify(dbBefore || {}, null, 2) + "\n");
  await writeFile(path.join(evidenceDir, "db-after.json"), JSON.stringify(dbAfter || {}, null, 2) + "\n");
  await writeFile(
    path.join(evidenceDir, "db-before.sql"),
    dbQueries?.before || "-- SQL text is not retained in this file. Captured runtime query results, when available, are in db-before.json.\n"
  );
  await writeFile(
    path.join(evidenceDir, "db-after.sql"),
    dbQueries?.after || "-- SQL text is not retained in this file. Captured runtime query results, when available, are in db-after.json.\n"
  );
}

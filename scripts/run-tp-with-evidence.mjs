import { spawnSync, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Explicit allowlist: TP-01 is deliberately not executable through this runner.
const runners = {
  "TP-02a": "test-tp02a-distributed-lock.mjs",
  "TP-02b": "test-tp02b-lock-heartbeat.mjs",
  "TP-02c": "test-checkout-lock-http.mjs",
  "TP-03": "test-checkout-lock-http.mjs",
  "TP-04a": "test-cart-mutation-http.mjs",
  "TP-04b": "test-cart-mutation-http.mjs",
  "TP-06a": "test-inventory-ledger.mjs",
  "TP-06b": "test-inventory-ledger.mjs",
  "TP-07a": "test-inventory-ledger.mjs",
  "TP-24c": "test-inventory-ledger.mjs",
  "TP-21c": "test-tp21c-refund-identity.mjs",
};
const id = process.argv[2];
if (!Object.hasOwn(runners, id)) throw new Error("TP runner is not authorized: " + id);
const root = process.cwd();
const directory = path.join(root, "artifacts", "tp-evidence", id);
const startedAt = new Date().toISOString();
const history = path.join(root, "artifacts", "tp-evidence-history", id, startedAt.replace(/[:.]/g, "-"));
await mkdir(path.dirname(history), { recursive: true });
try { await rename(directory, history); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(directory, { recursive: true });
const script = "apps/backend/scripts/" + runners[id];
const args = ["TP-02c", "TP-03", "TP-04a", "TP-04b", "TP-06a", "TP-06b", "TP-07a", "TP-24c"].includes(id) ? [id] : [];
const child = spawnSync(process.execPath, [script, ...args], {
  cwd: root, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const stdout = child.stdout || "";
const stderr = (child.stderr || "") + (child.error ? String(child.error.stack || child.error) + "\n" : "");
process.stdout.write(stdout);
process.stderr.write(stderr);
const exitCode = child.status ?? 1;
let result;
try { result = JSON.parse(await readFile(path.join(directory, "result.json"), "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  // Failure to start the harness is still a failed command, never a pass.
  result = {
    tpId: id, status: "failed", startedAt,
    commitSha: process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    nodeVersion: process.version,
    packageLockSha256: createHash("sha256").update(await readFile("package-lock.json")).digest("hex"),
    behavioralTestExecuted: false,
    blocker: "Runner exited without producing result.json; inspect raw stderr.",
  };
}
if (exitCode !== 0 && result.status === "passed") {
  result.status = "failed";
  result.blocker = "Child process failed after writing a passing result.";
}
if (result.status !== "passed" && exitCode === 0) {
  process.exitCode = 1;
}
Object.assign(result, {
  commandStartedAt: startedAt, commandEndedAt: new Date().toISOString(),
  testCommand: ["node", script, ...args].join(" "),
  evidenceCommand: "node scripts/run-tp-with-evidence.mjs " + id,
  processExitCode: exitCode, processSignal: child.signal,
  rawStreamsCaptured: true,
});
await writeFile(path.join(directory, "stdout.log"), stdout);
await writeFile(path.join(directory, "stderr.log"), stderr);
await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
process.exitCode = process.exitCode || exitCode;

/**
 * Verify the installed Medusa CLI / tsconfig-paths compatibility patch.
 * This is a low-noise diagnostic: no preload, monkey-patching, or stack dump.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const repositoryRoot = path.resolve(__dirname, "..");
const backendRoot = path.join(repositoryRoot, "apps", "backend");
const projectPath = path.join(backendRoot, "tsconfig.json");
const rootRequire = createRequire(path.join(repositoryRoot, "package.json"));
const cliEntry = rootRequire.resolve("@medusajs/cli");
const cliRoot = path.resolve(path.dirname(cliEntry), "..");
const cliPackage = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"));
const cliSourcePath = path.join(cliRoot, "cli.js");
const cliSource = fs.readFileSync(cliSourcePath, "utf8");
const cliRegistrationLines = cliSource.split(/\r?\n/).filter(
  (line) => line.includes("tsconfig-paths") && line.includes("register")
);
const invalidEmptyOptionsCall = /\.register\s*\(\s*\{\s*\}\s*\)/;
const compatibleNoArgumentCall = /\.register\s*\(\s*\)/;
const cliRequire = createRequire(cliEntry);
const tsconfigPathsEntry = cliRequire.resolve("tsconfig-paths");
const tsconfigPathsRoot = path.resolve(path.dirname(tsconfigPathsEntry), "..");
const tsconfigPathsPackage = JSON.parse(
  fs.readFileSync(path.join(tsconfigPathsRoot, "package.json"), "utf8")
);
const tsconfigPaths = cliRequire("tsconfig-paths");

process.chdir(backendRoot);
process.env.TS_NODE_PROJECT = projectPath;
const config = tsconfigPaths.loadConfig(backendRoot);

const result = {
  check: "Medusa CLI tsconfig-paths compatibility",
  cwd: process.cwd(),
  tsNodeProject: process.env.TS_NODE_PROJECT,
  medusaCliVersion: cliPackage.version,
  medusaCliSource: cliSourcePath,
  relevantRegistrationLines: cliRegistrationLines,
  tsconfigPathsVersion: tsconfigPathsPackage.version,
  tsconfigPathsEntry,
  configResult: config.resultType,
  configPath: config.configFileAbsolutePath ?? null,
  absoluteBaseUrl: config.absoluteBaseUrl ?? null,
  registerNoArgumentProbe: "not-run",
};

if (cliPackage.version !== "2.22.1") {
  throw new Error("Unexpected @medusajs/cli version " + cliPackage.version + "; review the guarded compatibility patch.");
}
if (tsconfigPathsPackage.version !== "3.15.0") {
  throw new Error("Unexpected tsconfig-paths version " + tsconfigPathsPackage.version + "; review the guarded compatibility patch.");
}
if (!cliRegistrationLines.some((line) => compatibleNoArgumentCall.test(line)) ||
    cliRegistrationLines.some((line) => invalidEmptyOptionsCall.test(line))) {
  throw new Error("Installed Medusa CLI does not contain the expected register() compatibility call.");
}
if (config.resultType !== "success" || path.resolve(config.absoluteBaseUrl ?? "") !== backendRoot) {
  throw new Error("tsconfig-paths could not load the backend tsconfig: " + (config.message ?? config.resultType));
}

let cleanup;
try {
  cleanup = tsconfigPaths.register();
  result.registerNoArgumentProbe = "passed";
} finally {
  if (typeof cleanup === "function") cleanup();
}

console.log(JSON.stringify(result, null, 2));
console.log("PASS: installed Medusa CLI uses register(), the backend tsconfig resolves, and register() succeeds without a tracing preload.");

/**
 * Read-only compatibility check for Medusa CLI's undeclared tsconfig-paths
 * dependency. It verifies which version the CLI resolves and that the
 * original register({}) invocation succeeds from the backend project directory.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const repositoryRoot = path.resolve(__dirname, "..");
const backendRoot = path.join(repositoryRoot, "apps", "backend");
const rootRequire = createRequire(path.join(repositoryRoot, "package.json"));
const cliEntry = rootRequire.resolve("@medusajs/cli");
const cliRequire = createRequire(cliEntry);
const tsconfigPathsEntry = cliRequire.resolve("tsconfig-paths");
const tsconfigPathsRoot = path.resolve(path.dirname(tsconfigPathsEntry), "..");
const tsconfigPathsPackage = JSON.parse(
  fs.readFileSync(path.join(tsconfigPathsRoot, "package.json"), "utf8")
);
const tsconfigPaths = cliRequire("tsconfig-paths");

process.chdir(backendRoot);
if (!/^4\./.test(tsconfigPathsPackage.version)) {
  throw new Error(
    "Expected the Medusa CLI to resolve tsconfig-paths 4.x; resolved " +
      tsconfigPathsPackage.version +
      " from " +
      tsconfigPathsEntry
  );
}

let cleanup;
try {
  cleanup = tsconfigPaths.register({});
} catch (error) {
  console.error("FAIL: tsconfig-paths 4.x register({}) threw from the backend directory.");
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
  throw error;
} finally {
  if (typeof cleanup === "function") cleanup();
}

console.log(JSON.stringify({
  cwd: process.cwd(),
  medusaCliVersion: JSON.parse(
    fs.readFileSync(path.join(path.dirname(cliEntry), "..", "package.json"), "utf8")
  ).version,
  tsconfigPathsVersion: tsconfigPathsPackage.version,
  tsconfigPathsEntry,
  invocation: "register({})",
  result: "passed"
}, null, 2));
console.log("PASS: Medusa CLI resolves tsconfig-paths 4.x and register({}) succeeds from apps/backend.");

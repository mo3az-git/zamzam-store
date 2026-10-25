/**
 * Compatibility patch for @medusajs/cli with tsconfig-paths 3.x.
 *
 * Medusa CLI currently calls tsconfigPaths.register({}). In tsconfig-paths
 * 3.x, any supplied object is treated as explicit registration parameters,
 * so an empty object sends an undefined baseUrl to path.isAbsolute().
 * Calling register() with no argument correctly loads the project's tsconfig.
 *
 * This is intentionally version-aware and fails closed if the expected call
 * shape changes, so a dependency update cannot silently invalidate the patch.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const roots = [
  path.resolve(__dirname, "..", "node_modules", "@medusajs", "cli"),
  path.resolve(__dirname, "..", "apps", "backend", "node_modules", "@medusajs", "cli")
];

const cliDir = roots.find((root) => fs.existsSync(path.join(root, "cli.js")));
if (!cliDir) {
  throw new Error(
    "Could not find @medusajs/cli/cli.js in the expected workspace install locations."
  );
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(cliDir, "package.json"), "utf8")
);
if (packageJson.version !== "2.22.1") {
  throw new Error(
    `Unexpected @medusajs/cli version ${packageJson.version}; review this compatibility patch before proceeding.`
  );
}

const cliPath = path.join(cliDir, "cli.js");
const source = fs.readFileSync(cliPath, "utf8");
const invalidCall = /require\((["'])tsconfig-paths\1\)\.register\(\s*\{\s*\}\s*\)/;

if (invalidCall.test(source)) {
  const patched = source.replace(
    invalidCall,
    'require("tsconfig-paths").register()'
  );
  fs.writeFileSync(cliPath, patched);
  console.log(
    "[compat] Patched @medusajs/cli tsconfig-paths registration to load tsconfig defaults."
  );
} else if (/require\((["'])tsconfig-paths\1\)\.register\(\s*\)/.test(source)) {
  console.log("[compat] @medusajs/cli tsconfig-paths registration is already compatible.");
} else {
  throw new Error(
    "The expected tsconfig-paths.register({}) call was not found. Review the installed @medusajs/cli source."
  );
}

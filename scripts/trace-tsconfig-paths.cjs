/**
 * Phase 1 diagnostic preload: trace the exact tsconfig-paths.register call.
 *
 * This is deliberately observational: it preserves the original function,
 * arguments, return value, and thrown errors. Remove once the upstream caller
 * is identified and the root cause is fixed.
 */
"use strict";

const Module = require("node:module");
const originalLoad = Module._load;
const wrapped = new WeakSet();

function instrument(moduleExports, request, parent) {
  if (!moduleExports || typeof moduleExports.register !== "function") {
    return moduleExports;
  }
  if (wrapped.has(moduleExports)) return moduleExports;
  wrapped.add(moduleExports);

  const originalRegister = moduleExports.register;
  moduleExports.register = function tracedTsconfigPathsRegister(...args) {
    const caller = parent?.filename ?? "<unknown>";
    console.error("[tsconfig-paths-trace] register invoked");
    console.error(JSON.stringify({
      request,
      caller,
      cwd: process.cwd(),
      TS_NODE_PROJECT: process.env.TS_NODE_PROJECT ?? null,
      argumentCount: args.length,
      firstArgumentType: typeof args[0],
      firstArgument: args[0] === undefined ? "<undefined>" : args[0]
    }, null, 2));
    console.error(new Error("[tsconfig-paths-trace] call stack").stack);
    return originalRegister.apply(this, args);
  };
  return moduleExports;
}

Module._load = function traceTsconfigPathsLoad(request, parent, isMain) {
  const exports = originalLoad.call(this, request, parent, isMain);
  if (request === "tsconfig-paths" ||
      (request === "./" && /[/\\]tsconfig-paths[/\\]register\.js$/.test(parent?.filename ?? ""))) {
    return instrument(exports, request, parent);
  }
  return exports;
};

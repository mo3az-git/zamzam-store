/**
 * Phase 1 diagnostic preload: trace the exact tsconfig-paths.register call.
 *
 * Observational only: a Proxy wraps the exported register function without
 * mutating tsconfig-paths exports (some versions expose register as a getter).
 * Original arguments, return values, and thrown errors are preserved.
 * Remove after the upstream caller and root cause are established.
 */
"use strict";

const Module = require("node:module");
const originalLoad = Module._load;
const proxies = new WeakMap();

function instrument(moduleExports, request, parent) {
  if (!moduleExports || (typeof moduleExports !== "object" && typeof moduleExports !== "function")) {
    return moduleExports;
  }
  if (proxies.has(moduleExports)) return proxies.get(moduleExports);

  const caller = parent?.filename ?? "<unknown>";
  const wrappedRegister = new WeakMap();
  const proxy = new Proxy(moduleExports, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "register" || typeof value !== "function") return value;
      if (wrappedRegister.has(value)) return wrappedRegister.get(value);

      const traced = function tracedTsconfigPathsRegister(...args) {
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
        return Reflect.apply(value, this, args);
      };
      wrappedRegister.set(value, traced);
      return traced;
    }
  });
  proxies.set(moduleExports, proxy);
  return proxy;
}

Module._load = function traceTsconfigPathsLoad(request, parent, isMain) {
  const exports = originalLoad.call(this, request, parent, isMain);
  if (request === "tsconfig-paths" ||
      (request === "./" && /[/\\\\]tsconfig-paths[/\\\\]register\\.js$/.test(parent?.filename ?? ""))) {
    return instrument(exports, request, parent);
  }
  return exports;
};

import { ESLint } from "eslint";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Workspace `eslint .` does not discover .mjs runners by default. Catch
// undefined assertion variables before spending a disposable-service CI run.
const eslint = new ESLint({
  useEslintrc: false,
  baseConfig: {
    env: { es2022: true, node: true },
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-undef": "error" },
  },
});
const results = await eslint.lintFiles(["scripts/**/*.mjs", "apps/backend/scripts/**/*.mjs"]);
const formatted = await (await eslint.loadFormatter("stylish")).format(results);
if (formatted) process.stdout.write(formatted);
const errors = results.reduce((sum, item) => sum + item.errorCount, 0);
console.log(`Harness static check: ${results.length} files, ${errors} errors.`);
const require = createRequire(import.meta.url);
const nativeCartRoot = path.join(path.dirname(require.resolve("@medusajs/medusa/package.json")), "dist/api/store/carts");
function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === "route.js" ? [file] : [];
  });
}
let coveredMutations = 0;
const missing = [];
for (const file of routeFiles(nativeCartRoot)) {
  const relative = path.relative(nativeCartRoot, file).replaceAll("\\", "/");
  // Never execute or wrap TP-01 cart creation. Checkout has its own protocol.
  if (relative === "route.js" || relative === "[id]/complete/route.js") continue;
  const methods = new Set([...readFileSync(file, "utf8").matchAll(/exports\.(POST|PUT|PATCH|DELETE)\s*=/g)].map((match) => match[1]));
  if (!methods.size) continue;
  let source = "";
  try { source = readFileSync(path.join("apps/backend/src/api/store/carts", relative.replace(/\.js$/, ".ts")), "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const method of methods) {
    if (source.includes(`export const ${method} = withCartMutationLock(native${method})`)) coveredMutations++;
    else missing.push(`${method} /store/carts/${relative.replace(/\/route\.js$/, "")}`);
  }
}
console.log(`Native cart mutation guard coverage: ${coveredMutations} methods, ${missing.length} missing.`);
for (const route of missing) console.error("Missing guarded native delegate: " + route);
process.exitCode = errors || missing.length ? 1 : 0;

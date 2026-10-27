import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const root = JSON.parse(read("package.json"))
const lock = JSON.parse(read("package-lock.json"))
const compose = read("compose.yaml")
const envExample = read(".env.example")
const storefrontEnvExample = read("apps/storefront/.env.example")
const backend = JSON.parse(read("apps/backend/package.json"))

assert.equal(root.engines.node, "24.22.x", "root Node engine must remain pinned")
assert.equal(lock.packages[""].engines.node, root.engines.node, "lockfile Node engine must match package.json")
assert.equal(read(".nvmrc").trim(), "24.22.1", ".nvmrc must identify the approved patch version")

for (const name of ["@medusajs/cli", "@medusajs/framework", "@medusajs/medusa"]) {
  assert.equal(backend.dependencies[name], "2.22.1", `${name} version drifted`)
}
const storefront = JSON.parse(read("apps/storefront/package.json"))
assert.equal(storefront.dependencies.next, "15.5.28")
assert.equal(storefront.dependencies.react, "18.3.1")
assert.equal(storefront.dependencies["react-dom"], "18.3.1")
for (const name of ["@medusajs/cli", "@medusajs/framework", "@medusajs/medusa"]) {
  assert.equal(lock.packages[`apps/backend`].dependencies[name], "2.22.1", `lockfile ${name} version drifted`)
}

assert.match(envExample, /LOCAL DEVELOPMENT ONLY|local development|local-only/i, "root env example must be explicitly local-only")
assert.match(storefrontEnvExample, /\[TEMPLATE\]/, "storefront env example must remain a placeholder template")
assert.match(compose, /postgres:16\.15@sha256:[a-f0-9]{64}/, "PostgreSQL image must be digest-pinned")
assert.match(compose, /redis:7\.2\.16@sha256:[a-f0-9]{64}/, "Redis image must be digest-pinned")
assert.match(compose, /pg_isready/, "PostgreSQL must have a readiness check")
assert.match(compose, /redis-cli", "ping"/, "Redis must have a ping check")
assert.match(compose, /postgres_data:\s*\n\s*redis_data:/, "local services must use named data volumes")

console.log("Operational preflight passed (static configuration only; no services contacted).")

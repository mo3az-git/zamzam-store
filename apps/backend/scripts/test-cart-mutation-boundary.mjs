import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(scriptDir, "..")
const repositoryRoot = path.resolve(backendRoot, "../..")
const rootRequire = createRequire(path.join(repositoryRoot, "package.json"))
rootRequire("ts-node").register({
  project: path.join(backendRoot, "tsconfig.json"),
  transpileOnly: true,
})

const { ContainerRegistrationKeys, MedusaError, Modules } = rootRequire("@medusajs/framework/utils")
const { cartMutationGuard, withCartMutationLock } = rootRequire(
  path.join(backendRoot, "src/api/cart-mutation-guard.ts")
)
const errorMiddleware = rootRequire(path.join(backendRoot, "src/api/middlewares.ts")).default.errorHandler

let passed = 0

function makeRequest({ status, path = "/store/carts/cart_test123", dbError, lock } = {}) {
  const reads = []
  const pg = {
    async raw(sql, values) {
      reads.push({ sql, values })
      if (dbError) throw dbError
      return { rows: status ? [{ status }] : [] }
    },
  }
  return {
    req: {
      path,
      scope: {
        resolve(key) {
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
          if (key === Modules.LOCKING) return lock
          throw new Error("Unexpected dependency: " + key)
        },
      },
    },
    reads,
  }
}

function errorResponse(error) {
  const response = {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
  errorMiddleware(error, {
    path: "/store/carts/cart_test123",
    scope: { resolve: () => ({ error() {}, info() {} }) },
  }, response, () => {})
  return response
}

async function run() {
  for (const status of ["in_progress", "completed"]) {
    let called = false
    const { req } = makeRequest({ status })
    const route = withCartMutationLock(async () => { called = true })
    await assert.rejects(route(req, {}), (error) => error.type === MedusaError.Types.CONFLICT)
    assert.equal(called, false)
    console.log(`PASS ${status} checkout session rejects before native mutation`)
    passed++
  }

  for (const status of ["aborted", "failed", undefined]) {
    let called = false
    const lock = { async execute(_key, job) { return job() } }
    const { req } = makeRequest({ status, lock })
    const route = withCartMutationLock(async () => { called = true })
    await route(req, {})
    assert.equal(called, true)
    console.log(`PASS ${status ?? "missing"} session follows the existing mutable policy`)
    passed++
  }

  {
    const databaseError = new Error("database host, credentials, and query details")
    let called = false
    const { req } = makeRequest({ dbError: databaseError, lock: { execute: async (_key, job) => job() } })
    const route = withCartMutationLock(async () => { called = true })
    await assert.rejects(route(req, {}), (error) => error === databaseError)
    assert.equal(called, false)
    console.log("PASS unexpected database error blocks native mutation and remains an internal error")
    passed++
  }

  {
    let called = false
    const { req } = makeRequest({ path: "/store/carts/%E0%A4%A", lock: { execute: async (_key, job) => job() } })
    const route = withCartMutationLock(async () => { called = true })
    await assert.rejects(route(req, {}), URIError)
    assert.equal(called, false)
    console.log("PASS malformed encoded cart identifier cannot reach the handler")
    passed++
  }

  {
    const owner = "execute:test-owner"
    const locks = new Map()
    let finishHandler
    let handlerEntered
    const entered = new Promise((resolve) => { handlerEntered = resolve })
    const gate = new Promise((resolve) => { finishHandler = resolve })
    let calls = 0
    let lockOptions
    const locking = {
      async execute(key, job, options) {
        assert.equal(locks.has(key), false)
        lockOptions = options
        locks.set(key, owner)
        try { return await job() }
        finally {
          assert.equal(locks.get(key), owner, "lock ownership changed before release")
          locks.delete(key)
        }
      },
    }
    const { req } = makeRequest({ lock: locking })
    const route = withCartMutationLock(async () => {
      calls++
      assert.equal(locks.get("cart:cart_test123"), owner, "lock must precede native handler")
      handlerEntered()
      await gate
    })
    const first = route(req, {})
    await entered
    assert.deepEqual(lockOptions, { timeout: 2, expire: 15 })
    assert.equal(locks.get("cart:cart_test123"), owner, "lock must remain held while handler is pending")
    const contenderRequest = makeRequest({ lock: locking }).req
    let contenderRan = false
    const contender = withCartMutationLock(async () => { contenderRan = true })
    // A provider rejects contending acquisition without taking or releasing the first owner's lock.
    const originalExecute = locking.execute
    locking.execute = async (key, job, options) => {
      if (locks.has(key)) throw new MedusaError(MedusaError.Types.CONFLICT, "Timed-out acquiring lock.")
      return originalExecute(key, job, options)
    }
    await assert.rejects(contender(contenderRequest, {}), (error) => error.code === "LOCK_TIMEOUT")
    assert.equal(contenderRan, false)
    assert.equal(locks.get("cart:cart_test123"), owner)
    assert.equal(calls, 1)
    finishHandler()
    await first
    assert.equal(locks.has("cart:cart_test123"), false)
    console.log("PASS lock precedes handler, excludes a contender, preserves owner, and releases after completion")
    passed++
  }

  {
    let called = false
    const locking = { async execute() { throw new MedusaError(MedusaError.Types.CONFLICT, "Timed-out acquiring lock.") } }
    const { req } = makeRequest({ lock: locking })
    const route = withCartMutationLock(async () => { called = true })
    await assert.rejects(route(req, {}), (error) =>
      error.type === MedusaError.Types.CONFLICT && error.code === "LOCK_TIMEOUT" && error.message === "Cart checkout lock timeout"
    )
    assert.equal(called, false)
    console.log("PASS acquisition timeout maps to the fixed public LOCK_TIMEOUT conflict")
    passed++
  }

  {
    const nativeError = new MedusaError(MedusaError.Types.INVALID_DATA, "native validation error")
    const locking = { async execute(_key, job) { return job() } }
    const { req } = makeRequest({ lock: locking })
    const route = withCartMutationLock(async () => { throw nativeError })
    await assert.rejects(route(req, {}), (error) => error === nativeError)
    console.log("PASS native Medusa handler errors remain authoritative")
    passed++
  }

  {
    const databaseError = new Error("private database details")
    const { req } = makeRequest({ dbError: databaseError })
    let nextError
    await cartMutationGuard(req, {}, (error) => { nextError = error })
    assert.equal(nextError, databaseError)
    console.log("PASS middleware guard forwards unexpected database errors without authorizing a write")
    passed++
  }

  {
    const timeoutResponse = errorResponse(new MedusaError(MedusaError.Types.CONFLICT, "private lock provider detail", "LOCK_TIMEOUT"))
    assert.equal(timeoutResponse.statusCode, 409)
    assert.deepEqual(timeoutResponse.body, {
      type: "conflict",
      code: "LOCK_TIMEOUT",
      message: "Cart checkout lock timeout",
    })
    const internalResponse = errorResponse(new Error("database host, inventory state, and payment details"))
    assert.equal(internalResponse.statusCode, 500)
    assert.equal(JSON.stringify(internalResponse.body).includes("database host"), false)
    assert.equal(JSON.stringify(internalResponse.body).includes("payment details"), false)
    console.log("PASS timeout exposes only its approved message and internal errors are redacted")
    passed++
  }

  console.log(`Cart mutation boundary: ${passed} checks passed.`)
  if (process.exitCode) process.exit(process.exitCode)
}

await run()

import assert from "node:assert/strict"
import { once } from "node:events"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  registerTsNode,
  verifyDisposableTargetServices,
  loadMedusaRuntime,
  createPgClient,
  createRedisClient,
  safeCloseClients,
} from "./shared/tp-harness.mjs"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { ContainerRegistrationKeys, Modules } = registerTsNode()("@medusajs/framework/utils")
const passed = []
const cleanupErrors = []
const fixtureId = randomUUID()
const leaseOwner = "cart-mutation-integration:" + fixtureId

let runtime, server, pg, redis, cartService, apiKeyService, regionService, salesChannelService, firstRequest
let cart, apiKey, region, salesChannel, sessionId, provider, checkoutLockHeld = false

function check(name, condition, evidence = undefined) {
  assert.ok(condition, name)
  passed.push(name)
  console.log("PASS " + name + (evidence === undefined ? "" : ": " + JSON.stringify(evidence)))
}

async function waitFor(promise, label, timeoutMs = 7000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out waiting for " + label)), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function responseFor(suffix, body, method = "POST") {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/store/carts/${cart.id}${suffix}`, {
    method,
    headers: { "content-type": "application/json", "x-publishable-api-key": apiKey.token },
    body: method === "GET" ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
  return { status: response.status, body: parsed }
}

async function cartSnapshot() {
  const result = await pg.query("SELECT id, metadata FROM cart WHERE id=$1", [cart.id])
  return result.rows[0]
}

async function setSessionStatus(status) {
  await pg.query("UPDATE cart_checkout_session SET status=$2 WHERE cart_id=$1", [cart.id, status])
}

function assertSafeUnknownError(response, privateDetail) {
  const body = JSON.stringify(response.body)
  assert.equal(response.status, 500)
  assert.equal(body.includes(privateDetail), false)
  assert.equal(body.includes("database host"), false)
  assert.equal(body.includes("redis endpoint"), false)
  assert.equal(response.body.message, "An unknown error occurred.")
}

try {
  // This gate runs before opening either service connection or creating fixtures.
  const target = verifyDisposableTargetServices(
    process.env.DATABASE_URL,
    process.env.LOCKING_REDIS_URL || process.env.REDIS_URL
  )
  check("approved_disposable_postgres_and_redis_targets", target.verified, {
    profile: target.executionProfile,
    database: target.pgDatabase,
    postgresHost: target.pgHost,
    redisHost: target.redisHost,
  })

  pg = createPgClient(process.env.DATABASE_URL)
  redis = createRedisClient(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
  await pg.connect()
  await redis.connect()

  process.env.PHASE1_DISABLE_ADMIN = "true"
  runtime = await loadMedusaRuntime({ entryPoints: true })
  const container = runtime.container
  cartService = container.resolve(Modules.CART)
  apiKeyService = container.resolve(Modules.API_KEY)
  regionService = container.resolve(Modules.REGION)
  salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const locking = container.resolve(Modules.LOCKING)
  const providerRegistration = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  provider = providerRegistration
  check("real_medusa_runtime_and_redis_locking_provider", provider.constructor.name === "SafeRedisLockingProvider", {
    medusa: "2.22.1",
    provider: provider.constructor.name,
  })

  server = runtime.app.listen(0, "127.0.0.1")
  await once(server, "listening")
  apiKey = await apiKeyService.createApiKeys({
    title: "cart mutation boundary disposable " + fixtureId,
    type: "publishable",
    created_by: "cart-mutation-integration",
  })
  region = await regionService.createRegions({
    name: "cart mutation boundary disposable " + fixtureId,
    currency_code: "egp",
    countries: ["eg"],
  })
  salesChannel = await salesChannelService.createSalesChannels({
    name: "cart mutation boundary disposable " + fixtureId,
  })

  // Use trusted CartService directly. This intentionally does not call POST /store/carts,
  // add variants, create orders, or exercise the prohibited TP-01 scenario.
  cart = await cartService.createCarts({
    currency_code: "egp",
    region_id: region.id,
    sales_channel_id: salesChannel.id,
    metadata: { fixture: "cart-mutation-http-integration", test_id: fixtureId },
  })
  const checkoutSessions = container.resolve("batch_inventory")
  await checkoutSessions.createCartCheckoutSessions({
    cart_id: cart.id,
    current_attempt_id: randomUUID(),
    epoch: 1,
    status: "in_progress",
  })
  sessionId = cart.id

  const getControl = await responseFor("", null, "GET")
  check("native_medusa_http_cart_control", getControl.status === 200 && getControl.body.cart?.id === cart.id, {
    status: getControl.status,
  })

  let before = await cartSnapshot()
  const inProgress = await responseFor("", { metadata: { unauthorized: "in_progress" } })
  check("in_progress_session_returns_409_and_public_code", inProgress.status === 409 &&
    inProgress.body.code === "CART_MUTATIONS_LOCKED" &&
    inProgress.body.message === "Cart checkout currently in progress; mutations locked", inProgress)
  assert.deepEqual(await cartSnapshot(), before)

  await setSessionStatus("completed")
  before = await cartSnapshot()
  const completed = await responseFor("", { metadata: { unauthorized: "completed" } })
  check("completed_session_returns_409_and_public_code", completed.status === 409 &&
    completed.body.code === "CART_ALREADY_COMPLETED" &&
    completed.body.message === "Cart has already been converted to an order", completed)
  assert.deepEqual(await cartSnapshot(), before)

  await setSessionStatus("aborted")
  const nativeValidation = await responseFor("/line-items", { quantity: 0 })
  check("native_line_item_validation_is_not_replaced_by_guard", nativeValidation.status === 400 &&
    nativeValidation.body.type === "invalid_data" && nativeValidation.body.code !== "LOCK_TIMEOUT", {
    status: nativeValidation.status,
    type: nativeValidation.body.type,
    code: nativeValidation.body.code,
  })
  assert.deepEqual(await cartSnapshot(), before)

  const cartLockKey = "cart:" + cart.id
  const physicalLockKey = provider.keyNamePrefix + cartLockKey
  await locking.acquire(cartLockKey, { ownerId: leaseOwner, expire: 120 })
  checkoutLockHeld = true
  const beforeContended = await cartSnapshot()
  const contended = await responseFor("", { metadata: { unauthorized: "contended" } })
  check("real_redis_lock_contention_returns_public_lock_timeout", contended.status === 409 &&
    contended.body.code === "LOCK_TIMEOUT" &&
    contended.body.message === "Cart checkout lock timeout", contended)
  assert.deepEqual(await cartSnapshot(), beforeContended)
  check("checkout_lock_owner_survives_contending_http_request",
    await redis.get(physicalLockKey) === leaseOwner && await redis.ttl(physicalLockKey) > 0)
  await locking.release(cartLockKey, { ownerId: leaseOwner })
  checkoutLockHeld = false

  // Pause the actual native update-cart workflow after it starts. The request
  // remains server-side while a second real HTTP mutation contends for Redis.
  const engine = container.resolve(Modules.WORKFLOW_ENGINE)
  const originalRun = engine.run
  let enterHandler, finishHandler
  const handlerEntered = new Promise((resolve) => { enterHandler = resolve })
  const handlerGate = new Promise((resolve) => { finishHandler = resolve })
  engine.run = async function(workflowId, args) {
    if (workflowId === "update-cart" && args?.input?.id === cart.id) {
      enterHandler()
      await handlerGate
    }
    return originalRun.call(this, workflowId, args)
  }
  try {
    firstRequest = responseFor("", { metadata: { native_handler_completed: true } })
    await waitFor(handlerEntered, "native update-cart workflow entry")
    const firstOwner = await redis.get(physicalLockKey)
    check("redis_lock_is_held_while_real_native_handler_is_pending",
      typeof firstOwner === "string" && firstOwner.startsWith("execute:") && await redis.ttl(physicalLockKey) > 0)

    const beforeContender = await cartSnapshot()
    const contender = await responseFor("", { metadata: { contender_must_not_write: true } })
    check("competing_native_mutation_gets_safe_timeout", contender.status === 409 && contender.body.code === "LOCK_TIMEOUT", {
      status: contender.status,
      code: contender.body.code,
    })
    assert.deepEqual(await cartSnapshot(), beforeContender)
    check("competing_request_preserves_first_redis_owner", await redis.get(physicalLockKey) === firstOwner)
  } finally {
    finishHandler()
    engine.run = originalRun
  }
  const firstResult = await firstRequest
  check("first_native_handler_finishes_successfully", firstResult.status === 200 &&
    firstResult.body.cart?.metadata?.native_handler_completed === true, { status: firstResult.status })
  const afterCompletion = await cartSnapshot()
  check("native_update_persists_after_handler_completes", afterCompletion.metadata?.native_handler_completed === true)
  check("real_redis_lock_released_after_native_handler_completion", await redis.get(physicalLockKey) === null)

  // Fault the guard's PostgreSQL query itself. The real Express middleware and
  // native handler are still exercised; the injected failure must fail closed.
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const knexClient = pgConnection.client
  const originalQuery = knexClient.query
  const privateDatabaseDetail = "private_db_integration_detail_" + fixtureId.replaceAll("-", "_")
  let interceptedSessionQuery = 0
  let postgresErrorCode
  knexClient.query = function(connection, query) {
    if (typeof query?.sql === "string" && query.sql.toLowerCase().includes("select status from cart_checkout_session")) {
      interceptedSessionQuery++
      const failingQuery = {
        ...query,
        sql: query.sql.replace(/select\s+status/i, `select "${privateDatabaseDetail}"`),
      }
      return originalQuery.call(this, connection, failingQuery).catch((error) => {
        postgresErrorCode = error.code
        throw error
      })
    }
    return originalQuery.call(this, connection, query)
  }
  try {
    before = await cartSnapshot()
    const failedDbRead = await responseFor("", { metadata: { unauthorized: "db-error" } })
    assertSafeUnknownError(failedDbRead, privateDatabaseDetail)
    check("real_postgres_query_error_fails_closed_and_is_redacted",
      interceptedSessionQuery > 0 && postgresErrorCode === "42703", {
      status: failedDbRead.status,
      code: failedDbRead.body.code,
      type: failedDbRead.body.type,
      postgresErrorCode,
    })
    assert.deepEqual(await cartSnapshot(), before)
  } finally {
    delete knexClient.query
  }

  // Exercise the real locking provider and HTTP error middleware with a
  // controlled Redis command failure, without exposing its private detail.
  const redisClient = provider.redisClient
  const originalAcquireMany = redisClient.acquireManyLocks
  const privateRedisDetail = "private-redis-integration-detail-" + fixtureId
  redisClient.acquireManyLocks = async () => { throw new Error("redis endpoint " + privateRedisDetail) }
  try {
    before = await cartSnapshot()
    const failedLock = await responseFor("", { metadata: { unauthorized: "redis-error" } })
    assertSafeUnknownError(failedLock, privateRedisDetail)
    check("lock_provider_failure_is_redacted_and_does_not_authorize_mutation", failedLock.body.type === "unknown_error", {
      status: failedLock.status,
      code: failedLock.body.code,
      type: failedLock.body.type,
    })
    assert.deepEqual(await cartSnapshot(), before)
  } finally {
    redisClient.acquireManyLocks = originalAcquireMany
  }

  console.log(`Real cart mutation HTTP integration: ${passed.length} checks passed.`)
} catch (error) {
  console.error("Cart mutation HTTP integration failed: " + (error?.stack || error))
  process.exitCode = 1
} finally {
  if (firstRequest) {
    try { await firstRequest }
    catch { /* Preserve the original assertion or request failure. */ }
  }
  if (server) {
    try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
    catch (error) { cleanupErrors.push("HTTP server: " + error.message) }
  }
  if (checkoutLockHeld && cart) {
    try { await runtime.container.resolve(Modules.LOCKING).release("cart:" + cart.id, { ownerId: leaseOwner }) }
    catch (error) { cleanupErrors.push("checkout lock: " + error.message) }
  }
  if (pg && cart) {
    try { await pg.query("DELETE FROM cart_checkout_session WHERE cart_id=$1", [sessionId]) }
    catch (error) { cleanupErrors.push("checkout session: " + error.message) }
    if (cartService) {
      try { await cartService.deleteCarts(cart.id) }
      catch (error) { cleanupErrors.push("cart: " + error.message) }
    }
  }
  if (apiKey && apiKeyService) {
    try {
      await apiKeyService.revoke(apiKey.id, { revoked_by: "cart-mutation-integration" })
      await apiKeyService.deleteApiKeys(apiKey.id)
    } catch (error) { cleanupErrors.push("publishable key: " + error.message) }
  }
  if (region && regionService) {
    try { await regionService.deleteRegions(region.id) }
    catch (error) { cleanupErrors.push("region: " + error.message) }
  }
  if (salesChannel && salesChannelService) {
    try { await salesChannelService.deleteSalesChannels(salesChannel.id) }
    catch (error) { cleanupErrors.push("sales channel: " + error.message) }
  }
  if (runtime) {
    try { await runtime.shutdown() }
    catch (error) { cleanupErrors.push("Medusa runtime: " + error.message) }
  }
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors })
  if (cleanupErrors.length) {
    console.error("Cleanup failures: " + cleanupErrors.join("; "))
    process.exitCode = 1
  }
}

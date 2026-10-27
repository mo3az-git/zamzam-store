import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import {
  registerTsNode,
  verifyDisposableTargetServices,
  loadMedusaRuntime,
  createPgClient,
  createRedisClient,
  safeCloseClients,
} from "./shared/tp-harness.mjs"

const rootRequire = registerTsNode()
const { ContainerRegistrationKeys, Modules } = rootRequire("@medusajs/framework/utils")
const { createRegionsWorkflow } = rootRequire("@medusajs/core-flows")
const { createGuestCartWithOwnership, invalidateGuestCartOwnership, resolveGuestCartOwnership } =
  rootRequire("./apps/backend/src/modules/batch-inventory/guest-cart-ownership.ts")
const { evaluateGuestCheckoutPreflight } = rootRequire("./apps/backend/src/modules/batch-inventory/guest-checkout-preflight.ts")
const fixtureId = randomUUID()
const passed = []
const cleanupErrors = []
const carts = []
const regions = []
let runtime, pg, redis, container, cartService, regionService, provider

function check(name, condition, evidence = undefined) {
  assert.ok(condition, name)
  passed.push(name)
  console.log("PASS " + name + (evidence === undefined ? "" : ": " + JSON.stringify(evidence)))
}

const hash = (token) => createHash("sha256").update(token, "utf8").digest("hex")
const guest = {
  email: "guest@example.invalid",
  first_name: "Disposable",
  last_name: "Visitor",
  phone: "+20 100 123 4567",
  address_1: "Disposable test address",
  city: "Cairo",
  country_code: "eg",
}

async function createOwnedCart(regionId) {
  const owned = await createGuestCartWithOwnership(container, { regionId })
  carts.push(owned)
  return owned
}

async function nativeCartSnapshot(cartId) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const result = await query.graph({
    entity: "cart",
    fields: [
      "id", "completed_at", "currency_code", "region_id", "region.id", "region.currency_code",
      "region.countries.iso_2", "shipping_address.address_1", "shipping_address.city",
      "shipping_address.country_code", "shipping_methods.shipping_option_id", "shipping_methods.amount",
      "shipping_methods.raw_amount", "shipping_total", "raw_shipping_total", "total", "raw_total",
    ],
    filters: { id: cartId },
  })
  return result.data[0]
}

try {
  // Reject unsafe targets before opening either client or creating any fixture.
  const target = verifyDisposableTargetServices(
    process.env.DATABASE_URL,
    process.env.LOCKING_REDIS_URL || process.env.REDIS_URL,
  )
  check("approved_disposable_postgres_and_redis_targets", target.verified, {
    profile: target.executionProfile, database: target.pgDatabase, postgresHost: target.pgHost, redisHost: target.redisHost,
  })

  pg = createPgClient(process.env.DATABASE_URL)
  redis = createRedisClient(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
  await pg.connect()
  await redis.connect()
  const columns = await pg.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='guest_cart_ownership'`)
  const columnNames = new Set(columns.rows.map((row) => row.column_name))
  check("guest_ownership_migration_applied", ["session_hash", "cart_id", "expires_at", "invalidated_at"].every((name) => columnNames.has(name)),
    { requiredColumnsPresent: ["session_hash", "cart_id", "expires_at", "invalidated_at"].every((name) => columnNames.has(name)) })

  process.env.PHASE1_DISABLE_ADMIN = "true"
  runtime = await loadMedusaRuntime({ entryPoints: false })
  container = runtime.container
  cartService = container.resolve(Modules.CART)
  regionService = container.resolve(Modules.REGION)
  const locking = container.resolve(Modules.LOCKING)
  provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  check("medusa_2_22_runtime_and_lock_provider_loaded", Boolean(cartService && provider?.redisClient), {
    medusa: "2.22.1", lockingProvider: provider.constructor.name,
  })

  const egRegion = (await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Guest ownership disposable EG " + fixtureId,
    currency_code: "egp",
    countries: ["eg"],
  }] } })).result[0]
  regions.push(egRegion.id)
  const usRegion = (await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Guest ownership disposable US " + fixtureId,
    currency_code: "usd",
    countries: ["us"],
  }] } })).result[0]
  regions.push(usRegion.id)

  const first = await createOwnedCart(egRegion.id)
  const second = await createOwnedCart(egRegion.id)
  check("native_medusa_guest_cart_creation_succeeds", first.cartId.startsWith("cart_") && second.cartId.startsWith("cart_"), {
    created: 2,
    customerIdReturned: false,
  })
  const firstBytes = Buffer.from(first.sessionSecret, "base64url")
  const secondBytes = Buffer.from(second.sessionSecret, "base64url")
  check("session_secrets_are_distinct_256_bit_random_values", firstBytes.length === 32 && secondBytes.length === 32 &&
    first.sessionSecret !== second.sessionSecret, { decodedBytesEach: 32, distinct: first.sessionSecret !== second.sessionSecret })

  const stored = await pg.query(`SELECT session_hash,cart_id,expires_at,invalidated_at
    FROM guest_cart_ownership WHERE cart_id=ANY($1::text[])`, [[first.cartId, second.cartId]])
  check("postgres_stores_only_sha256_digest_and_one_row_per_cart", stored.rows.length === 2 &&
    stored.rows.find((row) => row.cart_id === first.cartId)?.session_hash === hash(first.sessionSecret) &&
    stored.rows.find((row) => row.cart_id === second.cartId)?.session_hash === hash(second.sessionSecret) &&
    stored.rows.every((row) => row.session_hash !== first.sessionSecret && row.session_hash !== second.sessionSecret), {
    mappingRows: stored.rows.length, digestMatches: true, rawSecretStored: false,
  })
  const firstCount = await pg.query("SELECT count(*)::int AS count FROM guest_cart_ownership WHERE cart_id=$1", [first.cartId])
  check("exactly_one_ownership_mapping_per_cart", firstCount.rows[0].count === 1, { mappings: firstCount.rows[0].count })

  await pg.query("BEGIN")
  let uniqueViolation
  try {
    await pg.query("INSERT INTO guest_cart_ownership(session_hash,cart_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",
      [hash(randomUUID()), first.cartId])
  } catch (error) {
    uniqueViolation = error
  } finally {
    await pg.query("ROLLBACK")
  }
  check("postgres_unique_cart_binding_rejects_second_session", uniqueViolation?.code === "23505", {
    sqlState: uniqueViolation?.code ?? null,
  })

  let firstOwner = await resolveGuestCartOwnership(container, first.sessionSecret)
  let secondOwner = await resolveGuestCartOwnership(container, second.sessionSecret)
  check("correct_sessions_resolve_to_their_native_carts", firstOwner.status === "owned" && firstOwner.cartId === first.cartId &&
    secondOwner.status === "owned" && secondOwner.cartId === second.cartId &&
    !JSON.stringify(firstOwner).includes(first.sessionSecret) && !JSON.stringify(secondOwner).includes(second.sessionSecret), {
    firstStatus: firstOwner.status, firstCartMatches: firstOwner.status === "owned" && firstOwner.cartId === first.cartId,
    secondStatus: secondOwner.status, secondCartMatches: secondOwner.status === "owned" && secondOwner.cartId === second.cartId,
  })
  check("wrong_session_cart_pair_and_cart_id_alone_are_rejected",
    (await resolveGuestCartOwnership(container, first.sessionSecret, second.cartId)).status === "not_owned" &&
    (await resolveGuestCartOwnership(container, second.cartId)).status === "not_owned" &&
    (await resolveGuestCartOwnership(container, "not-a-session-token", first.cartId)).status === "not_owned")

  const expiry = await createOwnedCart(egRegion.id)
  await pg.query("UPDATE guest_cart_ownership SET expires_at=NOW()-INTERVAL '1 second' WHERE cart_id=$1", [expiry.cartId])
  check("expired_session_cannot_recover_ownership", (await resolveGuestCartOwnership(container, expiry.sessionSecret)).status === "expired")

  const revoked = await createOwnedCart(egRegion.id)
  check("explicit_invalidation_revokes_session", await invalidateGuestCartOwnership(container, revoked.sessionSecret) &&
    (await resolveGuestCartOwnership(container, revoked.sessionSecret)).status === "not_owned")

  const completed = await createOwnedCart(egRegion.id)
  const ordersBefore = await pg.query('SELECT count(*)::int AS count FROM "order"')
  // Simulate Medusa's completed cart marker directly in the disposable fixture; no order or workflow is created.
  await pg.query("UPDATE cart SET completed_at=NOW() WHERE id=$1", [completed.cartId])
  const completedResult = await resolveGuestCartOwnership(container, completed.sessionSecret)
  const ordersAfter = await pg.query('SELECT count(*)::int AS count FROM "order"')
  check("completed_native_cart_is_invalidated_without_order_creation", completedResult.status === "not_owned" &&
    completedResult.blocker === "CHECKOUT_ALREADY_COMPLETED" && ordersBefore.rows[0].count === ordersAfter.rows[0].count, {
    ownershipStatus: completedResult.status, blocker: completedResult.status === "not_owned" ? completedResult.blocker : null,
    orderCountUnchanged: ordersBefore.rows[0].count === ordersAfter.rows[0].count,
  })

  const lockingCart = await createOwnedCart(egRegion.id)
  const cartLockId = "cart:" + lockingCart.cartId
  const lockOwner = "guest-ownership-integration:" + fixtureId
  await locking.acquire(cartLockId, { ownerId: lockOwner, expire: 60 })
  try {
    check("real_redis_active_cart_lock_fails_closed",
      await redis.get(provider.keyNamePrefix + cartLockId) === lockOwner &&
      (await resolveGuestCartOwnership(container, lockingCart.sessionSecret)).status === "unavailable")
  } finally {
    await locking.release(cartLockId, { ownerId: lockOwner })
  }

  const healthyRedisGet = provider.redisClient.get
  let redisFailureSeen = false
  provider.redisClient.get = async function(key, ...args) {
    if (key === provider.keyNamePrefix + "cart:" + lockingCart.cartId) {
      redisFailureSeen = true
      throw new Error("private disposable Redis failure " + fixtureId)
    }
    return healthyRedisGet.call(this, key, ...args)
  }
  try {
    const failedRedisResult = await resolveGuestCartOwnership(container, lockingCart.sessionSecret)
    check("redis_failure_never_grants_ownership_or_leaks_provider_detail", redisFailureSeen &&
      failedRedisResult.status === "unavailable" && !JSON.stringify(failedRedisResult).includes("private disposable Redis failure"), {
      status: failedRedisResult.status, privateDetailExposed: false,
    })
  } finally {
    provider.redisClient.get = healthyRedisGet
  }

  const knexClient = container.resolve(ContainerRegistrationKeys.PG_CONNECTION).client
  const healthyQuery = knexClient.query
  let postgresFailureSeen = false
  let postgresErrorCode = null
  knexClient.query = function(connection, query) {
    if (typeof query?.sql === "string" && query.sql.includes("FROM guest_cart_ownership")) {
      postgresFailureSeen = true
      const invalidQuery = { ...query, sql: query.sql.replace(/SELECT\s+cart_id,expires_at,invalidated_at/i, "SELECT private_missing_guest_ownership_column") }
      return healthyQuery.call(this, connection, invalidQuery).catch((error) => {
        postgresErrorCode = error.code
        throw error
      })
    }
    return healthyQuery.call(this, connection, query)
  }
  try {
    const failedDatabaseResult = await resolveGuestCartOwnership(container, lockingCart.sessionSecret)
    check("database_failure_never_grants_ownership_or_leaks_query_detail", postgresFailureSeen &&
      postgresErrorCode === "42703" && failedDatabaseResult.status === "unavailable" &&
      !JSON.stringify(failedDatabaseResult).includes("private_missing_guest_ownership_column"), {
      status: failedDatabaseResult.status, postgresSqlState: postgresErrorCode, privateDetailExposed: false,
    })
  } finally {
    delete knexClient.query
  }

  firstOwner = await resolveGuestCartOwnership(container, first.sessionSecret)
  const egSnapshot = await nativeCartSnapshot(first.cartId)
  const egPreflight = evaluateGuestCheckoutPreflight({ cart: egSnapshot, guest, ownership: firstOwner })
  check("real_native_egp_context_and_persisted_proof_feed_preflight", egSnapshot?.currency_code === "egp" &&
    egSnapshot?.region?.currency_code === "egp" &&
    egSnapshot?.region?.countries?.some((country) => String(country.iso_2).toLowerCase() === "eg") && firstOwner.status === "owned" &&
    !egPreflight.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"), {
    ownershipStatus: firstOwner.status, preflightStatus: egPreflight.status,
    cartCurrency: egSnapshot?.currency_code,
  })
  check("native_cart_without_shipping_or_positive_authoritative_total_stays_blocked",
    egPreflight.blockers.includes("MISSING_SHIPPING_METHOD") && egPreflight.blockers.includes("PAYABLE_TOTAL_UNAVAILABLE"), {
    missingShippingMethod: egPreflight.blockers.includes("MISSING_SHIPPING_METHOD"),
    payableTotalUnavailable: egPreflight.blockers.includes("PAYABLE_TOTAL_UNAVAILABLE"),
  })
  const noTotals = evaluateGuestCheckoutPreflight({
    cart: { ...egSnapshot, total: null, raw_total: null }, guest, ownership: firstOwner,
  })
  check("missing_native_payable_fields_block_preflight", noTotals.blockers.includes("PAYABLE_TOTAL_UNAVAILABLE"))

  const usCart = await createOwnedCart(usRegion.id)
  const usOwner = await resolveGuestCartOwnership(container, usCart.sessionSecret)
  const usSnapshot = await nativeCartSnapshot(usCart.cartId)
  const usPreflight = evaluateGuestCheckoutPreflight({ cart: usSnapshot, guest, ownership: usOwner })
  check("real_non_egp_region_and_currency_block_even_with_ownership", usOwner.status === "owned" &&
    usSnapshot?.region?.countries?.some((country) => String(country.iso_2).toLowerCase() === "us") &&
    usPreflight.blockers.includes("CART_CURRENCY_NOT_EGP") && usPreflight.blockers.includes("CART_REGION_NOT_EGYPT_EGP"), {
    ownerVerified: usOwner.status === "owned", currency: usSnapshot?.currency_code,
    regionCurrency: usSnapshot?.region?.currency_code,
  })

  console.log(`Real guest cart ownership integration: ${passed.length} checks passed.`)
} catch (error) {
  console.error("Guest cart ownership integration failed: " + (error?.stack || error))
  process.exitCode = 1
} finally {
  if (runtime && carts.length) {
    for (const cart of carts) {
      try { await pg?.query("DELETE FROM guest_cart_ownership WHERE cart_id=$1", [cart.cartId]) }
      catch (error) { cleanupErrors.push("ownership row cleanup: " + error.message) }
      try { await cartService?.deleteCarts(cart.cartId) }
      catch (error) { cleanupErrors.push("cart cleanup: " + error.message) }
    }
  }
  if (regionService) {
    for (const regionId of regions) {
      try { await regionService.deleteRegions(regionId) }
      catch (error) { cleanupErrors.push("region cleanup: " + error.message) }
    }
  }
  if (runtime) {
    try { await runtime.shutdown() }
    catch (error) { cleanupErrors.push("Medusa runtime shutdown: " + error.message) }
  }
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors })
  if (cleanupErrors.length) {
    console.error("Cleanup failures: " + cleanupErrors.join("; "))
    process.exitCode = 1
  }
}

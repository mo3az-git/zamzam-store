import assert from "node:assert/strict"
import { once } from "node:events"
import { createHash, randomUUID } from "node:crypto"
import {
  verifyDisposableTargetServices, registerTsNode, loadMedusaRuntime,
  createPgClient, createRedisClient, safeCloseClients,
} from "./shared/tp-harness.mjs"

const rootRequire = registerTsNode()
const { ContainerRegistrationKeys, Modules } = rootRequire("@medusajs/framework/utils")
const { createProductVariantsWorkflow } = rootRequire("@medusajs/core-flows")
const fixtureId = randomUUID()
const passed = []
const cleanupErrors = []
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex")
let runtime, server, pg, redis, regionService, channels, products, cartService, apiKeys, links
let region, salesChannel, product, publishableKey, variant, createdCartId
let guestCookie = ""
const createdCartIds = []
const guestSecrets = []

function check(name, condition, evidence) {
  assert.ok(condition, name)
  passed.push(name)
  console.log("PASS " + name + (evidence === undefined ? "" : ": " + JSON.stringify(evidence)))
}

async function request(body, cookie = guestCookie) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/store/cart-bff`, {
    method: "POST",
    headers: {
      origin: process.env.STORE_CORS,
      "content-type": "application/json",
      "x-zamzam-cart-csrf": "1",
      "x-publishable-api-key": publishableKey.token,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
  return { status: response.status, body: parsed, headers: response.headers }
}

async function nativeSnapshot(cartId) {
  const result = await runtime.container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "cart",
    fields: ["id", "currency_code", "raw_subtotal", "raw_total", "shipping_methods.id", "items.id", "items.variant_id", "items.quantity", "items.raw_unit_price", "items.raw_total"],
    filters: { id: cartId },
  })
  return result.data[0]
}

try {
  const target = verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
  check("approved_disposable_postgres_and_redis_targets", target.verified, { database: target.pgDatabase, postgresHost: target.pgHost, redisHost: target.redisHost })
  pg = createPgClient(process.env.DATABASE_URL)
  redis = createRedisClient(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
  await pg.connect()
  await redis.connect()

  process.env.PHASE1_DISABLE_ADMIN = "true"
  runtime = await loadMedusaRuntime({ entryPoints: true })
  const container = runtime.container
  cartService = container.resolve(Modules.CART)
  regionService = container.resolve(Modules.REGION)
  channels = container.resolve(Modules.SALES_CHANNEL)
  products = container.resolve(Modules.PRODUCT)
  apiKeys = container.resolve(Modules.API_KEY)
  links = container.resolve(ContainerRegistrationKeys.LINK)
  const locking = container.resolve(Modules.LOCKING)
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  check("real_medusa_runtime_and_redis_lock_provider_loaded", provider.constructor.name === "SafeRedisLockingProvider")

  server = runtime.app.listen(0, "127.0.0.1")
  await once(server, "listening")
  process.env.STORE_CORS = `http://127.0.0.1:${server.address().port}`
  region = await regionService.createRegions({ name: "Cart BFF disposable " + fixtureId, currency_code: "egp", countries: ["eg"] })
  process.env.ZAMZAM_EGP_REGION_ID = region.id
  salesChannel = await channels.createSalesChannels({ name: "Cart BFF disposable " + fixtureId })
  process.env.ZAMZAM_SALES_CHANNEL_ID = salesChannel.id
  publishableKey = await apiKeys.createApiKeys({ title: "Cart BFF disposable " + fixtureId, type: "publishable", created_by: "cart-bff-http-integration" })
  await links.create({ [Modules.API_KEY]: { publishable_key_id: publishableKey.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannel.id } })
  product = await products.createProducts({ title: "Cart BFF disposable " + fixtureId, status: "published", options: [] })
  const variantResult = await createProductVariantsWorkflow(container).run({ input: { product_variants: [{
    product_id: product.id, title: "Medusa-priced disposable variant", manage_inventory: false,
    sku: "CART-BFF-" + fixtureId.slice(0, 8), prices: [{ amount: 61.70, currency_code: "egp" }],
  }] } })
  variant = variantResult.result[0]
  await links.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannel.id } })

  const create = await request({ operation: "create", requestId: randomUUID() }, "")
  const setCookie = create.headers.get("set-cookie") ?? ""
  const secret = /zamzam_guest_cart=([^;]+)/.exec(setCookie)?.[1]
  assert.equal(create.status, 200)
  assert.ok(secret, "the trusted issuer must set the HttpOnly ownership cookie")
  guestCookie = "zamzam_guest_cart=" + secret
  check("guest_cart_issued_through_http_only_cookie_without_json_secret_or_cart_id",
    create.body.ok === true && !JSON.stringify(create.body).includes(decodeURIComponent(secret)) && !("id" in (create.body.cart ?? {})) && setCookie.includes("HttpOnly"))
  const ownerRow = await pg.query("SELECT cart_id,session_hash FROM guest_cart_ownership WHERE session_hash=$1", [digest(decodeURIComponent(secret))])
  createdCartId = ownerRow.rows[0]?.cart_id
  createdCartIds.push(createdCartId)
  guestSecrets.push(decodeURIComponent(secret))
  assert.ok(createdCartId)
  check("ownership_cookie_resolves_only_to_agent_a_persisted_mapping", ownerRow.rows.length === 1 && ownerRow.rows[0].session_hash !== decodeURIComponent(secret))

  const missingOwner = await request({ operation: "read", requestId: randomUUID() }, "")
  const badOrigin = await fetch(`http://127.0.0.1:${server.address().port}/store/cart-bff`, {
    method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json", "x-zamzam-cart-csrf": "1" },
    body: JSON.stringify({ operation: "read", requestId: randomUUID() }),
  })
  check("missing_guest_proof_and_untrusted_origin_are_denied", missingOwner.status === 404 && badOrigin.status === 404)
  const cartIdInjection = await request({ operation: "read", requestId: randomUUID(), cartId: "cart_other_guest" })
  check("client_cart_id_is_rejected_by_closed_contract", cartIdInjection.status === 400)

  const initial = await request({ operation: "read", requestId: randomUUID() })
  assert.equal(initial.status, 200)
  const initialVersion = initial.body.cart.version
  const addBody = { operation: "add_item", requestId: randomUUID(), expectedVersion: initialVersion, variantId: variant.id, quantity: 2 }
  const add = await request(addBody)
  assert.equal(add.status, 200, JSON.stringify(add.body))
  const addReplay = await request(addBody)
  const cartAfterAdd = await nativeSnapshot(createdCartId)
  check("native_medusa_add_uses_server_price_and_owner_scoped_replay", addReplay.status === 200 &&
    add.body.cart.items.length === 1 && add.body.cart.items[0].variantId === variant.id &&
    add.body.cart.items[0].unitPrice.currency === "egp" && add.body.cart.items[0].unitPrice.amount === (() => {
      const raw = String(cartAfterAdd.items[0].raw_unit_price.value); const [whole, fraction = ""] = raw.split(".")
      return whole + "." + (fraction + "00").slice(0, 2)
    })() &&
    Number(cartAfterAdd.items[0].quantity) === 2 && JSON.stringify(add.body) === JSON.stringify(addReplay.body), {
    currency: add.body.cart.items[0].unitPrice.currency, priceMatchesMedusa: true, nativeQuantity: cartAfterAdd.items[0].quantity,
  })
  const changedReplay = await request({ ...addBody, quantity: 3 })
  check("same_owner_request_id_with_changed_body_conflicts", changedReplay.status === 409 && changedReplay.body.blockers?.includes("CART_IDEMPOTENCY_CONFLICT"))
  const stale = await request({ ...addBody, requestId: randomUUID() })
  check("stale_cart_version_is_rejected_before_a_second_native_mutation", stale.status === 409 && stale.body.blockers?.includes("CART_VERSION_CONFLICT") && Number((await nativeSnapshot(createdCartId)).items[0].quantity) === 2)

  const ownerACookie = guestCookie
  const secondCreate = await request({ operation: "create", requestId: randomUUID() }, "")
  const secondSecret = /zamzam_guest_cart=([^;]+)/.exec(secondCreate.headers.get("set-cookie") ?? "")?.[1]
  assert.ok(secondSecret)
  guestSecrets.push(decodeURIComponent(secondSecret))
  const secondOwner = await pg.query("SELECT cart_id FROM guest_cart_ownership WHERE session_hash=$1", [digest(decodeURIComponent(secondSecret))])
  createdCartIds.push(secondOwner.rows[0].cart_id)
  const secondCartRead = await request({ operation: "read", requestId: randomUUID() }, "zamzam_guest_cart=" + secondSecret)
  const crossCartUpdate = await request({ operation: "update_item", requestId: randomUUID(), expectedVersion: secondCartRead.body.cart.version,
    lineItemId: add.body.cart.items[0].lineItemId, quantity: 5 }, "zamzam_guest_cart=" + secondSecret)
  check("second_guest_cannot_mutate_first_guests_line_item", secondOwner.rows[0].cart_id !== createdCartId &&
    crossCartUpdate.status === 404 && Number((await nativeSnapshot(createdCartId)).items[0].quantity) === 2)
  guestCookie = ownerACookie

  const versionAfterAdd = add.body.cart.version
  const lineId = add.body.cart.items[0].lineItemId
  const update = await request({ operation: "update_item", requestId: randomUUID(), expectedVersion: versionAfterAdd, lineItemId: lineId, quantity: 3 })
  assert.equal(update.status, 200, JSON.stringify(update.body))
  check("native_medusa_quantity_update_preserves_catalog_price", update.body.cart.items[0].quantity === 3 &&
    update.body.cart.items[0].unitPrice.amount === add.body.cart.items[0].unitPrice.amount)

  const address = { email: "guest@example.invalid", firstName: "QA", lastName: "Guest", phone: "+201001234567",
    governorateId: "cairo", city: "Cairo", address1: "Disposable test address", notes: "Leave at reception" }
  const addressSet = await request({ operation: "set_delivery", requestId: randomUUID(), expectedVersion: update.body.cart.version, delivery: address })
  assert.equal(addressSet.status, 200, JSON.stringify(addressSet.body))
  check("address_mutation_uses_canonical_governorate_and_safe_allowlist", addressSet.body.cart.delivery?.governorateId === "cairo" && addressSet.body.cart.delivery?.notes === address.notes)

  const preflight = await request({ operation: "checkout_preflight", requestId: randomUUID(), expectedVersion: addressSet.body.cart.version, paymentMethod: "cod" })
  const ordersBefore = await pg.query('SELECT count(*)::int AS count FROM "order"')
  check("checkout_preflight_stays_read_only_and_blocked_without_shipping_or_payment_activation",
    preflight.status === 409 && preflight.body.checkout?.status === "blocked" &&
    preflight.body.blockers.includes("SHIPPING_RATE_UNCONFIGURED") && preflight.body.blockers.includes("PAYMENT_METHOD_UNAVAILABLE") &&
    (await nativeSnapshot(createdCartId)).shipping_methods?.length === 0)

  const remove = await request({ operation: "remove_item", requestId: randomUUID(), expectedVersion: addressSet.body.cart.version, lineItemId: lineId })
  assert.equal(remove.status, 200, JSON.stringify(remove.body))
  check("native_medusa_line_item_removal_succeeds", remove.body.cart.items.length === 0)
  const ordersAfter = await pg.query('SELECT count(*)::int AS count FROM "order"')
  check("no_order_created_during_cart_lifecycle_or_preflight", ordersBefore.rows[0].count === ordersAfter.rows[0].count)

  const completed = await fetch(`http://127.0.0.1:${server.address().port}/store/carts/${createdCartId}/complete`, {
    method: "POST", headers: { cookie: guestCookie, origin: process.env.STORE_CORS, "x-publishable-api-key": publishableKey.token },
  })
  check("native_cart_completion_remains_default_deny", completed.status === 404)
  console.log(`Real disposable Medusa Cart BFF HTTP integration: ${passed.length} checks passed.`)
} catch (error) {
  console.error("Cart BFF HTTP integration failed: " + (error?.stack || error))
  process.exitCode = 1
} finally {
  if (server) {
    try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
    catch (error) { cleanupErrors.push("HTTP server: " + error.message) }
  }
  if (createdCartIds.length) {
    for (const table of ["cart_bff_idempotency", "cart_bff_state", "guest_cart_ownership"]) {
      try {
        for (let index = 0; index < createdCartIds.length; index += 1) {
          await pg.query(`DELETE FROM ${table} WHERE ${table === "cart_bff_idempotency" ? "owner_key=$1" : "cart_id=$1"}`,
            [table === "cart_bff_idempotency" ? digest(guestSecrets[index]) : createdCartIds[index]])
        }
      }
      catch (error) { cleanupErrors.push(table + ": " + error.message) }
    }
    if (cartService) try { await cartService.deleteCarts(createdCartIds) } catch (error) { cleanupErrors.push("cart: " + error.message) }
  }
  if (publishableKey && apiKeys) try { await apiKeys.revoke(publishableKey.id, { revoked_by: "cart-bff-http-integration" }); await apiKeys.deleteApiKeys(publishableKey.id) } catch (error) { cleanupErrors.push("publishable key: " + error.message) }
  if (product && products) try { await products.deleteProducts(product.id) } catch (error) { cleanupErrors.push("product: " + error.message) }
  if (salesChannel && channels) try { await channels.deleteSalesChannels(salesChannel.id) } catch (error) { cleanupErrors.push("sales channel: " + error.message) }
  if (region && regionService) try { await regionService.deleteRegions(region.id) } catch (error) { cleanupErrors.push("region: " + error.message) }
  if (runtime) try { await runtime.shutdown() } catch (error) { cleanupErrors.push("Medusa runtime: " + error.message) }
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors })
  if (cleanupErrors.length) { console.error("Cleanup failures: " + cleanupErrors.join("; ")); process.exitCode = 1 }
}


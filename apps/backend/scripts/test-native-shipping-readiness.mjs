import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
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
const {
  createCartWorkflow,
  createRegionsWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
  updateCartWorkflow,
} = rootRequire("@medusajs/core-flows")
const { createGuestCartWithOwnership, resolveGuestCartOwnership } =
  rootRequire("./apps/backend/src/modules/batch-inventory/guest-cart-ownership.ts")
const { evaluateGuestCheckoutPreflight, validateGuestDeliveryInput } =
  rootRequire("./apps/backend/src/modules/batch-inventory/guest-checkout-preflight.ts")

const fixtureId = randomUUID()
const passed = []
const cleanupErrors = []
const carts = []
const regions = []
let runtime, pg, redis, container, cartService, regionService

function check(name, condition, evidence = undefined) {
  assert.ok(condition, name)
  passed.push(name)
  console.log("PASS " + name + (evidence === undefined ? "" : ": " + JSON.stringify(evidence)))
}

const guestInput = {
  email: "shipping-readiness@example.invalid",
  first_name: "Disposable",
  last_name: "Visitor",
  phone: "+20 100 123 4567",
  address_1: "Disposable integration address",
  city: "Cairo",
  country_code: "eg",
}

async function nativeCartSnapshot(cartId) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const result = await query.graph({
    entity: "cart",
    fields: [
      "id", "completed_at", "currency_code", "region_id", "region.id",
      "region.currency_code", "region.countries.iso_2",
      "email", "shipping_address.address_1", "shipping_address.city",
      "shipping_address.province", "shipping_address.country_code",
      "shipping_methods.shipping_option_id", "shipping_methods.amount",
      "shipping_methods.raw_amount", "subtotal", "raw_subtotal",
      "shipping_total", "raw_shipping_total", "total", "raw_total",
    ],
    filters: { id: cartId },
  })
  return result.data[0] ?? null
}

async function sideEffectCounts() {
  const counts = {}
  for (const table of ["order", "payment_collection", "payment", "payment_session",
    "invoice", "cart_batch_reservation", "cart_batch_allocation"]) {
    const relation = await pg.query("SELECT to_regclass($1) AS relation", ['public."' + table + '"'])
    if (relation.rows[0].relation) {
      const result = await pg.query('SELECT count(*)::text AS count FROM "' + table + '"')
      counts[table] = result.rows[0].count
    } else {
      counts[table] = null
    }
  }
  return counts
}

try {
  // Validate both approved disposable targets before connecting or creating fixtures.
  const target = verifyDisposableTargetServices(
    process.env.DATABASE_URL,
    process.env.LOCKING_REDIS_URL || process.env.REDIS_URL,
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
  runtime = await loadMedusaRuntime({ entryPoints: false })
  container = runtime.container
  cartService = container.resolve(Modules.CART)
  regionService = container.resolve(Modules.REGION)
  const fulfillment = container.resolve(Modules.FULFILLMENT)
  const providers = await fulfillment.listFulfillmentProviders()
  const serviceZones = await fulfillment.listServiceZones({})
  const configuredOptions = await fulfillment.listShippingOptions({})
  check("pinned_medusa_runtime_and_fulfillment_state_inspected",
    Array.isArray(providers) && Array.isArray(serviceZones) && Array.isArray(configuredOptions), {
      medusa: "2.22.1",
      providerIds: providers.map((provider) => provider.id),
      serviceZoneCount: serviceZones.length,
      configuredShippingOptionCount: configuredOptions.length,
    })

  const egRegion = (await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Disposable native shipping EG " + fixtureId,
    currency_code: "egp",
    countries: ["eg"],
  }] } })).result[0]
  regions.push(egRegion.id)

  const owned = await createGuestCartWithOwnership(container, { regionId: egRegion.id })
  carts.push(owned)
  const ownership = await resolveGuestCartOwnership(container, owned.sessionSecret)
  check("trusted_ownership_resolves_for_native_shipping_fixture",
    ownership.status === "owned" && ownership.cartId === owned.cartId)

  const validatedGuest = validateGuestDeliveryInput(guestInput)
  check("egyptian_guest_address_is_sanitized_for_native_cart_workflow",
    validatedGuest.valid && validatedGuest.address?.country_code === "eg" &&
      !Object.keys(validatedGuest.address ?? {}).some((key) => key.includes("amount") || key.includes("total")), {
      valid: validatedGuest.valid,
      countryCode: validatedGuest.address?.country_code,
    })
  await updateCartWorkflow(container).run({ input: {
    id: owned.cartId,
    email: validatedGuest.email,
    shipping_address: validatedGuest.address,
  } })

  const cart = await nativeCartSnapshot(owned.cartId)
  check("native_medusa_address_workflow_persists_eg_delivery_context",
    cart?.shipping_address?.address_1 === guestInput.address_1 &&
      cart?.shipping_address?.country_code === "eg" &&
      cart?.region?.currency_code === "egp" &&
      cart?.region?.countries?.some((country) => String(country.iso_2).toLowerCase() === "eg"), {
      currency: cart?.currency_code,
      regionCurrency: cart?.region?.currency_code,
      addressCountry: cart?.shipping_address?.country_code,
    })

  // The native workflow reads availability and calculated pricing from Medusa's
  // configured fulfillment providers, zones, options, cart and persisted address.
  const nativeOptionsRun = await listShippingOptionsForCartWithPricingWorkflow(container)
    .run({ input: { cart_id: owned.cartId } })
  const nativeOptions = nativeOptionsRun.result
  check("native_cart_shipping_options_workflow_returns_native_option_list",
    Array.isArray(nativeOptions), { optionCount: Array.isArray(nativeOptions) ? nativeOptions.length : null })

  const beforeReadiness = await sideEffectCounts()
  const preflight = evaluateGuestCheckoutPreflight({ cart, guest: guestInput, ownership })
  const cartAfterReadiness = await nativeCartSnapshot(owned.cartId)
  const afterReadiness = await sideEffectCounts()
  check("no_native_shipping_option_preserves_missing_method_blocker",
    nativeOptions.length === 0 && preflight.blockers.includes("MISSING_SHIPPING_METHOD"), {
      nativeOptionCount: nativeOptions.length,
      blockers: preflight.blockers,
    })
  check("empty_cart_has_no_authoritative_payable_total_and_stays_blocked",
    preflight.blockers.includes("PAYABLE_TOTAL_UNAVAILABLE") &&
      preflight.status === "blocked", {
      status: preflight.status,
      nativeCurrency: cart?.currency_code,
      nativeSubtotal: cart?.subtotal ?? null,
      nativeShippingTotal: cart?.shipping_total ?? null,
      nativeTotal: cart?.total ?? null,
      readiness: preflight.readiness,
    })

  const unknownQuoteCart = {
    ...cart,
    shipping_methods: [{ shipping_option_id: "native-unknown-price-contract", amount: null, raw_amount: null }],
    shipping_total: null,
    raw_shipping_total: null,
  }
  const unknownQuote = evaluateGuestCheckoutPreflight({
    cart: unknownQuoteCart,
    guest: guestInput,
    ownership,
  })
  check("unknown_shipping_amount_maps_to_price_unavailable",
    unknownQuote.blockers.includes("SHIPPING_PRICE_UNAVAILABLE"), {
      blocker: "SHIPPING_PRICE_UNAVAILABLE",
      source: "null-valued native shipping money contract fixture; no amount supplied",
    })

  const missingTotals = evaluateGuestCheckoutPreflight({
    cart: { ...cart, subtotal: null, raw_subtotal: null, total: null, raw_total: null },
    guest: guestInput,
    ownership,
  })
  check("missing_native_payable_total_maps_to_explicit_blocker",
    missingTotals.blockers.includes("PAYABLE_TOTAL_UNAVAILABLE"))

  const usRegion = (await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Disposable native shipping US " + fixtureId,
    currency_code: "usd",
    countries: ["us"],
  }] } })).result[0]
  regions.push(usRegion.id)
  const { result: usCart } = await createCartWorkflow(container).run({ input: { region_id: usRegion.id } })
  carts.push({ cartId: usCart.id })
  const usSnapshot = await nativeCartSnapshot(usCart.id)
  const wrongContext = evaluateGuestCheckoutPreflight({ cart: usSnapshot, guest: guestInput, ownership: null })
  check("wrong_native_currency_and_region_never_report_readiness",
    wrongContext.status === "blocked" &&
      wrongContext.blockers.includes("CART_CURRENCY_NOT_EGP") &&
      wrongContext.blockers.includes("CART_REGION_NOT_EGYPT_EGP"), {
      currency: usSnapshot?.currency_code,
      regionCurrency: usSnapshot?.region?.currency_code,
      status: wrongContext.status,
    })
  check("missing_trusted_ownership_cannot_report_readiness",
    wrongContext.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"))

  check("readiness_reads_do_not_create_orders_payments_invoices_or_reservations",
    JSON.stringify(beforeReadiness) === JSON.stringify(afterReadiness) &&
      JSON.stringify(cart) === JSON.stringify(cartAfterReadiness), {
      databaseCountsUnchanged: JSON.stringify(beforeReadiness) === JSON.stringify(afterReadiness),
      nativeCartSnapshotUnchanged: JSON.stringify(cart) === JSON.stringify(cartAfterReadiness),
      counts: afterReadiness,
    })

  console.log("Native shipping/payable readiness integration: " + passed.length + " checks passed.")
} catch (error) {
  console.error("Native shipping/payable readiness integration failed: " +
    JSON.stringify({ name: error?.name ?? "Error", code: error?.code ?? null }))
  process.exitCode = 1
} finally {
  for (const cart of carts) {
    try { await pg?.query("DELETE FROM guest_cart_ownership WHERE cart_id=$1", [cart.cartId]) }
    catch (error) { cleanupErrors.push("ownership cleanup " + (error?.code ?? "failed")) }
    try { await cartService?.deleteCarts(cart.cartId) }
    catch (error) { cleanupErrors.push("cart cleanup " + (error?.code ?? "failed")) }
  }
  if (regionService) {
    for (const regionId of regions) {
      try { await regionService.deleteRegions(regionId) }
      catch (error) { cleanupErrors.push("region cleanup " + (error?.code ?? "failed")) }
    }
  }
  if (runtime) {
    try { await runtime.shutdown() }
    catch (error) { cleanupErrors.push("Medusa runtime shutdown " + (error?.code ?? "failed")) }
  }
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors })
  if (cleanupErrors.length) {
    console.error("Native shipping/payable cleanup failures: " + cleanupErrors.join("; "))
    process.exitCode = 1
  }
}

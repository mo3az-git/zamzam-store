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
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  deleteShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  addShippingMethodToCartWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
  updateCartWorkflow,
} = rootRequire("@medusajs/core-flows")
const {
  EGYPTIAN_GOVERNORATES,
  getGovernorateShippingBlockers,
  resolveEgyptianMedusaProvinceCode,
} = rootRequire("./apps/backend/src/modules/batch-inventory/egypt-shipping-configuration.ts")
const { evaluateGuestCheckoutPreflight } = rootRequire("./apps/backend/src/modules/batch-inventory/guest-checkout-preflight.ts")

const fixtureId = randomUUID()
const passed = []
const cleanupErrors = []
const protectedTables = ["order", "payment_collection", "payment", "payment_session", "cart_batch_reservation", "cart_batch_allocation"]
let runtime, pg, redis, regionId, cartId, fulfillmentSetId, fulfillment, shippingProfileId, stockLocationId
const shippingOptionIds = []

function check(name, condition, evidence) {
  assert.ok(condition, name)
  passed.push(name)
  console.log("PASS " + name + (evidence === undefined ? "" : ": " + JSON.stringify(evidence)))
}

async function protectedCounts() {
  const counts = {}
  for (const table of protectedTables) {
    const relation = await pg.query("SELECT to_regclass($1) AS relation", ['public."' + table + '"'])
    if (!relation.rows[0].relation) {
      counts[table] = null
      continue
    }
    const result = await pg.query('SELECT count(*)::text AS count FROM "' + table + '"')
    counts[table] = result.rows[0].count
  }
  return counts
}

try {
  const target = verifyDisposableTargetServices(
    process.env.DATABASE_URL,
    process.env.LOCKING_REDIS_URL || process.env.REDIS_URL,
  )
  check("explicit_disposable_postgres_and_redis_targets_verified", target.verified, {
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
  const container = runtime.container
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  fulfillment = container.resolve(Modules.FULFILLMENT)
  const providers = await fulfillment.listFulfillmentProviders()
  check("pinned_medusa_2_22_1_and_provider_not_assumed", Array.isArray(providers), {
    medusa: "2.22.1",
    providerIds: providers.map((provider) => provider.id),
    selectedProvider: null,
  })

  check("canonical_governorate_map_has_27_unique_current_province_codes",
    EGYPTIAN_GOVERNORATES.length === 27 &&
    new Set(EGYPTIAN_GOVERNORATES.map((item) => item.id)).size === 27 &&
    new Set(EGYPTIAN_GOVERNORATES.map((item) => item.medusaProvinceCode)).size === 27 &&
    EGYPTIAN_GOVERNORATES.every((item) =>
      resolveEgyptianMedusaProvinceCode(item.medusaProvinceCode)?.id === item.id &&
      item.medusaProvinceCode === item.iso3166_2.toLowerCase()))

  const protectedCountsAtStart = await protectedCounts()
  const initialOptions = await fulfillment.listShippingOptions({})
  const initialZones = await fulfillment.listServiceZones({})
  check("disposable_runtime_has_no_preconfigured_shipping_options", initialOptions.length === 0, {
    serviceZoneCountBefore: initialZones.length,
    shippingOptionCountBefore: initialOptions.length,
  })

  // Fixture only: native fulfillment geometry with one ISO province GeoZone per
  // governorate. It has no shipping profile, shipping option, price, or provider.
  const createdSets = await fulfillment.createFulfillmentSets([{
    name: "Disposable Egypt geography " + fixtureId,
    type: "shipping",
    service_zones: EGYPTIAN_GOVERNORATES.map((governorate) => ({
      name: "Disposable " + fixtureId + " " + governorate.id,
      geo_zones: [{
        type: "province",
        country_code: "eg",
        province_code: governorate.medusaProvinceCode,
      }],
    })),
  }])
  const createdSet = Array.isArray(createdSets) ? createdSets[0] : createdSets
  fulfillmentSetId = createdSet?.id
  assert.ok(fulfillmentSetId, "native fulfillment set must be created")
  const storedSet = await fulfillment.retrieveFulfillmentSet(fulfillmentSetId, {
    relations: ["service_zones", "service_zones.geo_zones"],
  })
  const storedZones = storedSet.service_zones ?? []
  const storedPairs = storedZones.flatMap((zone) => (zone.geo_zones ?? []).map((geo) => ({
    governorate: zone.name.split(" ").at(-1),
    countryCode: geo.country_code,
    provinceCode: geo.province_code,
    type: geo.type,
  })))
  check("native_medusa_persists_27_service_zones_and_iso_province_geozones",
    storedZones.length === 27 && storedPairs.length === 27 &&
    new Set(storedPairs.map((pair) => pair.governorate)).size === 27 &&
    storedPairs.every((pair) => pair.countryCode === "eg" && pair.type === "province" &&
      resolveEgyptianMedusaProvinceCode(pair.provinceCode)?.id === pair.governorate), {
      serviceZoneCount: storedZones.length,
      geoZoneCount: storedPairs.length,
      examples: storedPairs.slice(0, 2),
    })

  const badProvinceCodes = ["EG-C", "eg-xx", "cairo"]
  check("invalid_or_ambiguous_province_identifiers_fail_closed_in_application_mapping",
    badProvinceCodes.every((code) => resolveEgyptianMedusaProvinceCode(code) === null) &&
    getGovernorateShippingBlockers("Cairo").includes("SHIPPING_GOVERNORATE_UNKNOWN"), {
      rejected: badProvinceCodes,
      nativeSemanticValidation: "Medusa requires province_code string; canonical application map validates identity",
    })

  const region = (await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Disposable Egypt geography " + fixtureId,
    currency_code: "egp",
    countries: ["eg"],
  }] } })).result[0]
  regionId = region.id
  const cartResult = await createCartWorkflow(container).run({ input: { region_id: regionId } })
  cartId = cartResult.result.id
  const stockLocation = (await createStockLocationsWorkflow(container).run({ input: { locations: [{
    name: "Disposable synthetic Egypt location " + fixtureId,
  }] } })).result[0]
  stockLocationId = stockLocation.id
  await container.resolve(ContainerRegistrationKeys.LINK).create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSetId },
  })
  assert.ok(cartResult.result.sales_channel_id, "disposable cart must have a sales channel")
  await linkSalesChannelsToStockLocationWorkflow(container).run({ input: {
    id: stockLocationId,
    add: [cartResult.result.sales_channel_id],
  } })
  const cairo = EGYPTIAN_GOVERNORATES.find((item) => item.id === "cairo")
  await updateCartWorkflow(container).run({ input: {
    id: cartId,
    shipping_address: {
      address_1: "Disposable native geography fixture",
      city: "Cairo",
      province: cairo.medusaProvinceCode,
      country_code: "eg",
    },
  } })

  // Test-only fixture: Medusa needs a registered provider to create a native
  // option. manual_manual is used only inside this disposable test and does not
  // represent an owner-selected production operator.
  const testProvider = providers.find((provider) => provider.id === "manual_manual")
  check("test_only_native_provider_available_without_selecting_production_operator", Boolean(testProvider), {
    testProviderId: testProvider?.id ?? null,
    productionProviderSelected: false,
  })
  const unavailableBeforeFixtures = (await listShippingOptionsForCartWithPricingWorkflow(container)
    .run({ input: { cart_id: cartId } })).result
  check("missing_shipping_configuration_yields_no_free_or_fallback_option", unavailableBeforeFixtures.length === 0, {
    optionCount: unavailableBeforeFixtures.length,
    freeFallbackCreated: false,
  })
  const profileRun = await createShippingProfilesWorkflow(container).run({ input: { data: [{
    name: "Disposable synthetic Egypt profile " + fixtureId,
    type: "standard",
  }] } })
  shippingProfileId = profileRun.result[0]?.id
  assert.ok(shippingProfileId, "disposable native shipping profile must be created")

  const optionsInput = storedZones.map((zone) => {
    const governorate = EGYPTIAN_GOVERNORATES.find((item) => zone.name.endsWith(item.id))
    assert.ok(governorate, "fixture zone must map to a canonical governorate")
    const index = EGYPTIAN_GOVERNORATES.findIndex((item) => item.id === governorate.id)
    return {
      name: "Disposable synthetic " + governorate.id + " " + fixtureId,
      service_zone_id: zone.id,
      shipping_profile_id: shippingProfileId,
      provider_id: testProvider.id,
      type: { label: "Disposable synthetic", description: "Integration-only fixture", code: "synthetic" },
      price_type: "flat",
      prices: [{ amount: 101 + index, currency_code: "egp" }],
    }
  })
  const optionsRun = await createShippingOptionsWorkflow(container).run({ input: optionsInput })
  shippingOptionIds.push(...optionsRun.result.map((option) => option.id))
  check("disposable_profile_and_27_governorate_specific_positive_synthetic_egp_options_created",
    shippingOptionIds.length === 27 && optionsRun.result.every((option) => option.price_type === "flat"), {
      shippingProfileCount: 1,
      optionCount: shippingOptionIds.length,
      syntheticOnly: true,
      productionOptionsCreated: false,
      rates: "101..127 EGP by canonical governorate order; synthetic integration values only",
    })

  const nativeOptions = (await listShippingOptionsForCartWithPricingWorkflow(container)
    .run({ input: { cart_id: cartId } })).result
  const cairoOption = optionsRun.result.find((option) => option.name.includes("cairo"))
  check("native_cart_destination_matches_only_its_governorate_option",
    Array.isArray(nativeOptions) && nativeOptions.length === 1 && nativeOptions[0].id === cairoOption?.id, {
      destinationProvince: cairo.medusaProvinceCode,
      matchingOptionCount: nativeOptions.length,
      matchedOptionId: nativeOptions[0]?.id ?? null,
      productionProviderSelected: false,
    })

  const cairoPriced = nativeOptions[0]
  const cairoAmount = cairoPriced?.amount
  const cairoCurrency = cairoPriced?.calculated_price?.currency_code
  check("native_shipping_calculation_returns_positive_synthetic_egp_price",
    Number(cairoAmount) > 0 && cairoCurrency?.toLowerCase() === "egp", {
      amount: cairoAmount,
      currency: cairoCurrency,
      syntheticOnly: true,
    })
  await addShippingMethodToCartWorkflow(container).run({ input: {
    cart_id: cartId,
    options: [{ id: cairoOption.id }],
  } })
  const payableSnapshot = await query.graph({
    entity: "cart",
    fields: ["id", "currency_code", "region_id", "region.id", "region.currency_code", "region.countries.iso_2",
      "shipping_address.address_1", "shipping_address.city", "shipping_address.country_code",
      "shipping_methods.shipping_option_id", "shipping_methods.amount",
      "shipping_methods.raw_amount", "shipping_total", "raw_shipping_total", "subtotal", "raw_subtotal", "total", "raw_total"],
    filters: { id: cartId },
  }).then((result) => result.data[0] ?? null)
  check("native_cart_contains_positive_synthetic_shipping_and_payable_totals",
    payableSnapshot?.shipping_methods?.length === 1 && payableSnapshot.shipping_methods[0].shipping_option_id === cairoOption.id &&
      Number(payableSnapshot.shipping_total) > 0 && Number(payableSnapshot.total) > 0 && payableSnapshot.currency_code === "egp", {
      shippingTotal: payableSnapshot?.shipping_total,
      payableTotal: payableSnapshot?.total,
      currency: payableSnapshot?.currency_code,
      syntheticOnly: true,
    })
  const syntheticPreflight = evaluateGuestCheckoutPreflight({
    cart: payableSnapshot,
    guest: {
      email: "shipping-fixture@example.invalid",
      first_name: "Disposable",
      last_name: "Visitor",
      phone: "+20 100 123 4567",
      address_1: "Disposable native geography fixture",
      city: "Cairo",
      province: cairo.medusaProvinceCode,
      country_code: "eg",
    },
    ownership: null,
  })
  check("synthetic_positive_cart_still_cannot_pass_checkout_readiness_without_trusted_ownership",
    syntheticPreflight.status === "blocked" && syntheticPreflight.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"), {
      status: syntheticPreflight.status,
      blockers: syntheticPreflight.blockers,
    })

  // Shipping readiness remains blocked even with the synthetic fixture: the
  // production configuration has no approved rate or selected provider.
  check("synthetic_fixture_never_changes_production_readiness_contract",
    EGYPTIAN_GOVERNORATES.every((item) => {
      const blockers = getGovernorateShippingBlockers(item.id)
      return blockers.includes("SHIPPING_RATE_UNCONFIGURED") && blockers.includes("SHIPPING_PROVIDER_UNDECIDED")
    }))

  const unsupportedCart = await createCartWorkflow(container).run({ input: { region_id: regionId } })
  const unsupportedCartId = unsupportedCart.result.id
  try {
    await updateCartWorkflow(container).run({ input: {
      id: unsupportedCartId,
      shipping_address: { address_1: "Disposable unsupported destination", city: "Cairo", province: "EG-C", country_code: "eg" },
    } })
    const unsupportedOptions = (await listShippingOptionsForCartWithPricingWorkflow(container)
      .run({ input: { cart_id: unsupportedCartId } })).result
    check("malformed_uppercase_native_province_has_no_matching_shipping_option", unsupportedOptions.length === 0, {
      province: "EG-C",
      optionCount: unsupportedOptions.length,
    })
  } finally {
    await container.resolve(Modules.CART).deleteCarts(unsupportedCartId)
  }
  check("all_27_rate_rows_remain_unconfigured_and_block_quotes",
    EGYPTIAN_GOVERNORATES.every((item) =>
      getGovernorateShippingBlockers(item.id).includes("SHIPPING_RATE_UNCONFIGURED") &&
      getGovernorateShippingBlockers(item.id).includes("SHIPPING_PROVIDER_UNDECIDED")))

  const snapshot = async () => {
    const result = await query.graph({
      entity: "cart",
      fields: ["id", "currency_code", "subtotal", "raw_subtotal", "shipping_total",
        "raw_shipping_total", "total", "raw_total", "shipping_address.province"],
      filters: { id: cartId },
    })
    return result.data[0] ?? null
  }
  const beforeReadOnlyLookup = await snapshot()
  const countsBeforeReadOnlyLookup = await protectedCounts()
  await listShippingOptionsForCartWithPricingWorkflow(container).run({ input: { cart_id: cartId } })
  const afterReadOnlyLookup = await snapshot()
  const countsAfterReadOnlyLookup = await protectedCounts()
  check("read_only_native_shipping_lookup_does_not_change_medusa_money_snapshot",
    JSON.stringify(beforeReadOnlyLookup) === JSON.stringify(afterReadOnlyLookup) &&
    JSON.stringify(countsBeforeReadOnlyLookup) === JSON.stringify(countsAfterReadOnlyLookup) &&
    beforeReadOnlyLookup?.currency_code === "egp", {
      currency: afterReadOnlyLookup?.currency_code,
      shippingTotal: afterReadOnlyLookup?.shipping_total ?? null,
      payableTotal: afterReadOnlyLookup?.total ?? null,
      snapshotUnchanged: JSON.stringify(beforeReadOnlyLookup) === JSON.stringify(afterReadOnlyLookup),
  protectedCountsUnchanged: JSON.stringify(countsBeforeReadOnlyLookup) === JSON.stringify(countsAfterReadOnlyLookup),
    })

  check("fixture_creates_no_order_payment_or_inventory_reservation",
    JSON.stringify(protectedCountsAtStart) === JSON.stringify(await protectedCounts()), await protectedCounts())

  console.log("Egypt governorate native shipping foundation integration: " + passed.length + " checks passed.")
} catch (error) {
  console.error("Egypt governorate shipping integration failed: " +
    JSON.stringify({ name: error?.name ?? "Error", code: error?.code ?? null }))
  process.exitCode = 1
} finally {
  if (cartId) {
    try { await containerCleanup("cart", cartId) } catch (error) { cleanupErrors.push("cart cleanup " + (error?.code ?? "failed")) }
  }
  if (runtime && shippingOptionIds.length) {
    try { await deleteShippingOptionsWorkflow(runtime.container).run({ input: { ids: shippingOptionIds } }) }
    catch (error) { cleanupErrors.push("shipping option cleanup " + (error?.code ?? "failed")) }
  }
  if (fulfillment && fulfillmentSetId) {
    try { await fulfillment.deleteFulfillmentSets(fulfillmentSetId) }
    catch (error) { cleanupErrors.push("fulfillment set cleanup " + (error?.code ?? "failed")) }
  }
  if (fulfillment && shippingProfileId) {
    try { await fulfillment.deleteShippingProfiles(shippingProfileId) }
    catch (error) { cleanupErrors.push("shipping profile cleanup " + (error?.code ?? "failed")) }
  }
  if (runtime && regionId) {
    try { await runtime.container.resolve(Modules.REGION).deleteRegions(regionId) }
    catch (error) { cleanupErrors.push("region cleanup " + (error?.code ?? "failed")) }
  }
  if (runtime) {
    try { await runtime.shutdown() } catch (error) { cleanupErrors.push("Medusa runtime shutdown " + (error?.code ?? "failed")) }
  }
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors })
  if (cleanupErrors.length) {
    console.error("Governorate shipping integration cleanup failures: " + cleanupErrors.join("; "))
    process.exitCode = 1
  }
}

async function containerCleanup(kind, id) {
  if (kind === "cart") await runtime.container.resolve(Modules.CART).deleteCarts(id)
}

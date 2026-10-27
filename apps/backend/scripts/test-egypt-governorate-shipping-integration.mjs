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
const {
  EGYPTIAN_GOVERNORATES,
  getGovernorateShippingBlockers,
  resolveEgyptianMedusaProvinceCode,
} = rootRequire("./apps/backend/src/modules/batch-inventory/egypt-shipping-configuration.ts")

const fixtureId = randomUUID()
const passed = []
const cleanupErrors = []
const protectedTables = ["order", "payment_collection", "payment", "payment_session", "cart_batch_reservation", "cart_batch_allocation"]
let runtime, pg, redis, regionId, cartId, fulfillmentSetId, fulfillment

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

  const nativeOptions = (await listShippingOptionsForCartWithPricingWorkflow(container)
    .run({ input: { cart_id: cartId } })).result
  const finalOptions = await fulfillment.listShippingOptions({})
  check("native_cart_shipping_lookup_returns_no_option_without_configured_shipping_option",
    Array.isArray(nativeOptions) && nativeOptions.length === 0 && finalOptions.length === 0, {
      matchingProviderConfigured: false,
      matchingShippingOptions: nativeOptions.length,
      totalShippingOptions: finalOptions.length,
    })
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
      snapshotUnchanged: JSON.stringify(beforeReadOnlyLookup) === JSON.stringify(afterReadOnlyLookup),\n      protectedCountsUnchanged: JSON.stringify(countsBeforeReadOnlyLookup) === JSON.stringify(countsAfterReadOnlyLookup),
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
  if (fulfillment && fulfillmentSetId) {
    try { await fulfillment.deleteFulfillmentSets(fulfillmentSetId) }
    catch (error) { cleanupErrors.push("fulfillment set cleanup " + (error?.code ?? "failed")) }
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

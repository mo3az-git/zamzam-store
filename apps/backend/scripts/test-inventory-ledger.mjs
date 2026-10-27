import { randomUUID, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import path from "node:path"
import {
  registerTsNode, repositoryRoot, backendRoot, getSystemMetadata,
  verifyDisposableTargetServices, loadMedusaRuntime, createPgClient,
  createRedisClient, safeCloseClients, writeTpEvidence,
} from "./shared/tp-harness.mjs"

const tpId = process.argv[2]
if (!["TP-06a", "TP-06b", "TP-07a", "TP-07b", "TP-09", "TP-10", "TP-24c", "TP-08-native-integration", "TP-08-recovery", "TP-05-native-order-binding"].includes(tpId)) throw new Error("Unsupported inventory TP: " + tpId)
if (process.env.PHASE1_ALLOW_DISPOSABLE_DB_CREATE_DROP !== "true") throw new Error("Disposable database create/drop opt-in is required")
const rootRequire = registerTsNode()
const { Modules, ContainerRegistrationKeys } = await import("@medusajs/framework/utils")
const { InventoryLedger, movementDedupKey } = rootRequire("./apps/backend/src/modules/batch-inventory/ledger.ts")
const { completeReservedCartWithInventory } = rootRequire("./apps/backend/src/modules/batch-inventory/native-checkout-coordinator.ts")
const { findNativeOrdersByCart } = rootRequire("./apps/backend/src/modules/batch-inventory/native-order-lookup.ts")
const metadata = await getSystemMetadata(), startedAt = new Date().toISOString()
const assertions = [], events = [], cleanupErrors = [], resources = { databaseCreated: false, rolesCreated: [] }
let rootPg, adminPg, probePg, runtime, locking, targetDetails, dbBefore, dbAfter, blocker = null, status = "failed", cleanupResult = null
const dbName = "zamzam_rollback_" + randomUUID().replaceAll("-", "_")
const roleSuffix = randomUUID().replaceAll("-", "").slice(0, 16)
const appPassword = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")
const probePassword = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")
const probeRole = "phase1_ledger_writer_" + roleSuffix
const safeIdent = (s) => '"' + s.replaceAll('"', '""') + '"'
const check = (name, expected, actual, pass) => {
  assertions.push({ name, expected, actual, passed: Boolean(pass) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`)
  if (!pass) throw new Error("Assertion failed: " + name)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitUntil = async (predicate, label, timeout = 5000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await delay(25) }
  throw new Error("Timed out waiting for " + label)
}
const pgUrlFor = (base, database) => { const url = new URL(base); url.pathname = "/" + database; return url.toString() }
const pgUrlAsRole = (base, user, password) => { const url = new URL(base); url.username = user; url.password = password; return url.toString() }
const snapshotTables = async (pg, batchIds = []) => {
  const batches = await pg.query("SELECT * FROM inventory_batch WHERE id=ANY($1::text[]) ORDER BY id", [batchIds])
  const reservations = await pg.query("SELECT * FROM cart_batch_reservation ORDER BY id")
  const allocations = await pg.query("SELECT * FROM order_batch_allocation ORDER BY id")
  const movements = await pg.query("SELECT * FROM inventory_movement ORDER BY id")
  const attempts = await pg.query("SELECT * FROM cart_checkout_attempt ORDER BY checkout_attempt_id")
  const sessions = await pg.query("SELECT * FROM cart_checkout_session ORDER BY cart_id")
  const leases = await pg.query("SELECT key,status,lease_owner_id,last_heartbeat_at FROM idempotency_key ORDER BY key")
  return { batches: batches.rows, reservations: reservations.rows, allocations: allocations.rows, movements: movements.rows, attempts: attempts.rows, sessions: sessions.rows, leases: leases.rows }
}
const expectCode = async (name, expectedCode, run, predicate = () => true) => {
  try { const value = await run(); check(name, expectedCode, { returned: value }, false) }
  catch (error) {
    const code = error.code || error.type || "unknown"
    check(name, expectedCode, { code, message: error.message }, (code === expectedCode || error.message.includes(expectedCode)) && predicate(error))
    return error
  }
}

try {
  const rootUrl = process.env.DATABASE_URL
  const target = verifyDisposableTargetServices(rootUrl, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
  targetDetails = target
  check("only_approved_disposable_service_target", true, target.verified, target.verified)
  rootPg = createPgClient(rootUrl); await rootPg.connect()
  const existing = await rootPg.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName])
  check("unique_fixture_database_does_not_preexist", 0, existing.rowCount, existing.rowCount === 0)
  await rootPg.query(`CREATE DATABASE ${safeIdent(dbName)}`)
  resources.databaseCreated = true
  const isolatedUrl = pgUrlFor(rootUrl, dbName)
  const migrate = spawnSync(process.execPath, [path.join(repositoryRoot, "node_modules/@medusajs/cli/cli.js"), "db:migrate"], {
    cwd: backendRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: isolatedUrl, PHASE1_ALLOW_DISPOSABLE_DB_CREATE_DROP: "false" },
  })
  await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(path.join(repositoryRoot, "artifacts", "tp-evidence", tpId), { recursive: true }).then(() => Promise.all([
    writeFile(path.join(repositoryRoot, "artifacts", "tp-evidence", tpId, "migrations.stdout.log"), migrate.stdout || ""),
    writeFile(path.join(repositoryRoot, "artifacts", "tp-evidence", tpId, "migrations.stderr.log"), migrate.stderr || ""),
  ])))
  check("fresh_isolated_database_migrations", 0, migrate.status, migrate.status === 0)

  const lockUrl = process.env.LOCKING_REDIS_URL || process.env.REDIS_URL
  if (tpId === "TP-24c") {
    const roles = await rootPg.query("SELECT rolname FROM pg_roles WHERE rolname IN ('medusa_app',$1)", [probeRole])
    check("immutability_fixture_roles_are_new", 0, roles.rowCount, roles.rowCount === 0)
    await rootPg.query(`CREATE ROLE medusa_app LOGIN PASSWORD '${appPassword}'`)
    resources.rolesCreated.push("medusa_app")
    await rootPg.query(`CREATE ROLE ${safeIdent(probeRole)} LOGIN PASSWORD '${probePassword}'`)
    resources.rolesCreated.push(probeRole)
    const schemaAdmin = createPgClient(isolatedUrl)
    await schemaAdmin.connect()
    try {
      const schemas = await schemaAdmin.query(`SELECT schema_name FROM information_schema.schemata
        WHERE schema_name NOT LIKE 'pg_%' AND schema_name<>'information_schema'`)
      for (const { schema_name: schema } of schemas.rows) {
        await schemaAdmin.query(`GRANT USAGE ON SCHEMA ${safeIdent(schema)} TO medusa_app`)
        await schemaAdmin.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${safeIdent(schema)} TO medusa_app`)
        await schemaAdmin.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${safeIdent(schema)} TO medusa_app`)
      }
      const movementRelations = await schemaAdmin.query(`SELECT n.nspname,c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='inventory_movement' AND c.relkind='r'`)
      if (movementRelations.rowCount !== 1) throw new Error("Expected one inventory_movement table in the isolated database")
      const movementTable = `${safeIdent(movementRelations.rows[0].nspname)}.${safeIdent(movementRelations.rows[0].relname)}`
      await schemaAdmin.query(`REVOKE ALL PRIVILEGES ON ${movementTable} FROM medusa_app`)
      await schemaAdmin.query(`GRANT SELECT, INSERT ON ${movementTable} TO medusa_app`)
      await schemaAdmin.query(`GRANT USAGE ON SCHEMA ${safeIdent(movementRelations.rows[0].nspname)} TO ${safeIdent(probeRole)}`)
      await schemaAdmin.query(`GRANT SELECT, UPDATE, DELETE ON ${movementTable} TO ${safeIdent(probeRole)}`)
    } finally { await schemaAdmin.end() }
    await rootPg.query("ALTER ROLE medusa_app NOINHERIT")
    process.env.DATABASE_URL = pgUrlAsRole(isolatedUrl, "medusa_app", appPassword)
  } else process.env.DATABASE_URL = isolatedUrl
  process.env.MEDUSA_WORKER_MODE = "server"
  process.env.PHASE1_DISABLE_ADMIN = "true"
  runtime = await loadMedusaRuntime()
  const knex = runtime.container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const cartService = runtime.container.resolve(Modules.CART)
  const productService = runtime.container.resolve(Modules.PRODUCT)
  const inventoryModule = runtime.container.resolve("batch_inventory")
  locking = runtime.container.resolve(Modules.LOCKING)
  const redisProvider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  const runtimeUser = (await knex.raw("SELECT current_user, session_user")).rows[0]
  check("real_medusa_container_uses_test_database_role", tpId === "TP-24c" ? "medusa_app" : "postgres", runtimeUser.current_user,
    tpId === "TP-24c" ? runtimeUser.current_user === "medusa_app" : runtimeUser.current_user !== "")
  adminPg = createPgClient(isolatedUrl); await adminPg.connect()

  const supplierId = "sup_" + randomUUID(), locationId = "loc_" + randomUUID()
  await adminPg.query("INSERT INTO supplier(id,name,country_code) VALUES($1,$2,'EG')", [supplierId, "Disposable TP supplier"])
  await adminPg.query("INSERT INTO inventory_location(id,name,address_line1,governorate_code) VALUES($1,$2,$3,'EG-C')", [locationId, "Disposable Cairo depot", "Test address"])
  let variantId = null
  if (tpId !== "TP-24c") {
    const product = await productService.createProducts({ title: "Disposable inventory ledger fixture " + randomUUID(), status: "published",
      options: [], variants: [{ title: "Batch tracked test variant", manage_inventory: false, sku: "TP-" + randomUUID(),
        metadata: { packaging: { min_shelf_life_days: 30 } } }] })
    const variants = await productService.listProductVariants({ product_id: product.id })
    variantId = variants[0]?.id
    check("native_variant_has_required_batch_metadata", { manage_inventory: false, min_shelf_life_days: 30 },
      { id: variantId, manage_inventory: variants[0]?.manage_inventory, packaging: variants[0]?.metadata?.packaging },
      Boolean(variantId) && variants[0]?.manage_inventory === false && variants[0]?.metadata?.packaging?.min_shelf_life_days === 30)
  }
  const makeBatch = async (quantity, days, suffix) => {
    const date = (await adminPg.query("SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date + ($1 * INTERVAL '1 day'))::date::text AS d", [days])).rows[0].d
    const ledger = new InventoryLedger(runtime.container)
    const receipt = await ledger.receiveBatch({ receiptOperationId: randomUUID(), variantId, locationId, supplierId,
      batchNumber: "lot-" + suffix, invoiceReference: "invoice-" + suffix, productionDate: null, expirationDate: date,
      purchaseCurrency: "EGP", purchasePrice: "10.0000", exchangeRate: "1.0000", allocatedCost: "2.0000",
      quantity, actorId: "fixture:receipt" })
    return receipt.batch
  }
  const makeCart = async (items, label = "inventory", nativeUnitPrice = 0) => {
    const cart = await cartService.createCarts({ currency_code: "egp", metadata: { disposable_fixture: tpId, label } })
    const nativeCheckout = ["TP-08-native-integration", "TP-08-recovery"].includes(tpId)
    const lineItems = items.map(({ quantity, key = randomUUID() }) => ({ title: "Native checkout batch line", product_title: "Disposable product",
      variant_title: "Batch tracked test variant", variant_id: variantId, quantity, unit_price: nativeCheckout ? nativeUnitPrice : 1000,
      requires_shipping: !nativeCheckout, metadata: { checkout_line_key: key } }))
    const lines = await cartService.addLineItems(cart.id, lineItems)
    const attemptId = randomUUID(), key = randomUUID(), ownerId = "worker:inventory:" + randomUUID()
    await inventoryModule.createCartCheckoutSessions({ cart_id: cart.id, current_attempt_id: attemptId, epoch: 1, status: "in_progress" })
    await adminPg.query(`INSERT INTO idempotency_key(key,request_path,request_hash,status,lease_owner_id,expires_at,locked_at,last_heartbeat_at)
      VALUES($1,$2,$3,'pending',$4,NOW()+INTERVAL '14 days',NOW(),NOW())`, [key, `/store/carts/${cart.id}/complete`, createHash("sha256").update(key).digest("hex"), ownerId])
    await adminPg.query(`INSERT INTO cart_checkout_attempt(checkout_attempt_id,cart_id,epoch,idempotency_key,payment_method,lease_owner_id)
      VALUES($1::uuid,$2,1,$3,'cod',$4)`, [attemptId, cart.id, key, ownerId])
    await locking.acquire("cart:" + cart.id, { ownerId, expire: 120 })
    const redisOwner = await redisProvider.redisClient.get(redisProvider.keyNamePrefix + "cart:" + cart.id)
    if (redisOwner !== ownerId) throw new Error("Fixture Redis cart lock was not acquired")
    return { cart, lines, authority: { cartId: cart.id, attemptId, epoch: 1, ownerId }, ownerId }
  }
  const makeNativeOrder = async (fixture, { lineKeys, lineQuantities, lineVariant, omitKey = [], duplicateKey, bindAttempt = true } = {}) => {
    const orderService = runtime.container.resolve(Modules.ORDER)
    const linkService = runtime.container.resolve(ContainerRegistrationKeys.LINK)
    const items = fixture.lines.map((line, index) => {
      const key = duplicateKey ?? lineKeys?.[index] ?? line.metadata?.checkout_line_key
      const metadata = { ...(line.metadata || {}) }
      if (omitKey.includes(index)) delete metadata.checkout_line_key
      else if (key) metadata.checkout_line_key = key
      return { title: line.title, variant_id: lineVariant ?? line.variant_id, quantity: lineQuantities?.[index] ?? Number(line.quantity),
        unit_price: 1000, metadata }
    })
    const order = await orderService.createOrders({ currency_code: "egp", items })
    await linkService.create({ [Modules.ORDER]: { order_id: order.id }, [Modules.CART]: { cart_id: fixture.cart.id } })
    if (bindAttempt) await adminPg.query(`UPDATE cart_checkout_attempt SET attempt_status='order_created',order_id=$1,order_correlation_status='correlated',updated_at=NOW()
      WHERE checkout_attempt_id=$2::uuid AND cart_id=$3`, [order.id, fixture.authority.attemptId, fixture.cart.id])
    return order
  }
  const reservationsFor = async (attemptId) => (await adminPg.query("SELECT * FROM cart_batch_reservation WHERE checkout_attempt_id=$1 ORDER BY id", [attemptId])).rows
  const conversionInput = (fixture, order, reservationIds) => ({ ...fixture.authority, orderId: order.id, validatedReservationIds: reservationIds })
  const convert = (fixture, order, ids, hooks) => new InventoryLedger(runtime.container, hooks).convertCartReservationsToAllocations(conversionInput(fixture, order, ids))
  const saveSnapshot = async (batchIds) => snapshotTables(adminPg, batchIds)

  if (tpId === "TP-05-native-order-binding") {
    // Unlike the zero-total native complete-cart suite, this is a real
    // positive-value native ORDER + inventory allocation + payment-branch
    // boundary. It does not assert that a payable completeCartWorkflow ran.
    const { recordPaymentForCorrelatedOrder } = await import(
      "../src/modules/order-operations/verified-payment-bridge.mjs")
    const orderService = runtime.container.resolve(Modules.ORDER)
    const batch = await makeBatch(25, 90, "payable-order-binding")
    dbBefore = await saveSnapshot([batch.id])
    const money = (value) => {
      // Medusa BigNumber/decimal values can serialize with trailing zeros
      // (e.g. 2000.0000000000000000). Normalize without Number/float.
      // Only exact hundredths are allowed: non-zero digits after the
      // second decimal place are rejected, never rounded.
      const raw = String(value ?? "")
      const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(raw)
      if (!match || match[1].length>10) throw new Error("NATIVE_TOTAL_NOT_CANONICAL: "+raw)
      const fraction = match[2] ?? ""
      if (fraction.slice(2).replace(/0/g,"") !== "") throw new Error("NATIVE_TOTAL_PRECISION_LOSS: "+raw)
      return match[1]+"."+fraction.slice(0,2).padEnd(2,"0")
    }
    for (const method of ["cod","electronic"]) {
      const fixture = await makeCart([{ quantity: 2 }], "real-payable-"+method)
      if (method === "electronic") await adminPg.query(
        "UPDATE cart_checkout_attempt SET payment_method='electronic' WHERE checkout_attempt_id=$1::uuid",
        [fixture.authority.attemptId])
      await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
      const order = await makeNativeOrder(fixture)
      const reservationIds = (await reservationsFor(fixture.authority.attemptId)).map(x=>x.id)
      const allocation = await convert(fixture, order, reservationIds)
      const nativeReader = async (orderId) => {
        const native = await orderService.retrieveOrder(orderId,{relations:["items","items.detail"]})
        return {id:native.id,currency_code:native.currency_code,total:money(native.total)}
      }
      const native = await nativeReader(order.id)
      check("native_order_has_real_positive_EGP_total_"+method,true,
        {orderId:order.id,cartId:fixture.cart.id,total:native.total},
        native.id===order.id && native.currency_code==="egp" && native.total!=="0.00" &&
        /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/.test(native.total))
      const attempt = (await adminPg.query(
        "SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid",
        [fixture.authority.attemptId])).rows[0]
      const binding = {...fixture.authority,orderId:order.id,idempotencyKey:attempt.idempotency_key,
        claimCodeHash:createHash("sha256").update("isolated-"+fixture.authority.attemptId).digest("hex")}
      const first = await recordPaymentForCorrelatedOrder(adminPg,binding,nativeReader)
      const replay = await recordPaymentForCorrelatedOrder(adminPg,binding,nativeReader)
      const operational=(await adminPg.query(
        "SELECT payment_method FROM order_operational_state WHERE order_id=$1 AND deleted_at IS NULL",
        [order.id])).rows
      const cod=(await adminPg.query(
        "SELECT expected_amount FROM cod_collection_record WHERE order_id=$1 AND deleted_at IS NULL",
        [order.id])).rows
      const electronic=(await adminPg.query(
        "SELECT amount,provider_key FROM electronic_payment_attempt WHERE order_id=$1 AND deleted_at IS NULL",
        [order.id])).rows
      check("positive_native_order_allocated_before_payment_"+method,true,{allocation,first},
        allocation && first.orderId===order.id && first.method===method)
      check("native_order_selects_exactly_one_payment_branch_"+method,true,
        {operational,cod,electronic,native},operational.length===1 &&
        operational[0].payment_method===method &&
        cod.length===Number(method==="cod") &&
        electronic.length===Number(method==="electronic") &&
        (method==="cod" ? cod[0]?.expected_amount===native.total :
          electronic[0]?.amount===native.total && electronic[0]?.provider_key==="phase1-simulator"))
      check("verified_payment_order_replay_idempotent_"+method,true,{first,replay},
        replay.orderId===order.id && replay.method===method && replay.amountCurrency==="EGP")
    }
    dbAfter = await saveSnapshot([batch.id])
    status = "passed"
  }

  if (tpId === "TP-08-recovery") {
    const { runNativeRecoveryScenarios } = await import("./test-native-recovery-scenarios.mjs")
    const batch = await makeBatch(200, 90, "native-recovery")
    dbBefore = await saveSnapshot([batch.id])
    await runNativeRecoveryScenarios({ runtime, knex, adminPg, batch, makeCart, makeNativeOrder,
      reservationsFor, convert, saveSnapshot, check, expectCode, events, InventoryLedger,
      completeReservedCartWithInventory, findNativeOrdersByCart, isolatedUrl, createPgClient })
    dbAfter = await saveSnapshot([batch.id])
    status = "passed"
  }

  if (tpId === "TP-08-native-integration") {
    const batch = await makeBatch(40, 90, "native-checkout")
    const fixture = await makeCart([{ quantity: 2 }, { quantity: 3 }], "real-native-complete-cart")
    const nativeCart = await cartService.retrieveCart(fixture.cart.id, { relations: ["items"] })
    check("real_medusa_cart_has_two_zero_total_managed_lines", 2,
      nativeCart.items.map((item) => ({ id: item.id, key: item.metadata?.checkout_line_key, quantity: item.quantity, unit_price: item.unit_price })),
      nativeCart.items.length === 2 && nativeCart.items.every((item) => Number(item.unit_price) === 0 && item.metadata?.checkout_line_key))

    const reserved = await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
    const reservationRows = await reservationsFor(fixture.authority.attemptId)
    check("native_cart_reservations_are_persisted_and_authoritative", 2,
      reservationRows.map((row) => ({ id: row.id, line: row.cart_line_item_id, key: row.checkout_line_key, quantity: row.quantity, status: row.status })),
      reserved.length === 2 && reservationRows.length === 2 && reservationRows.every((row) =>
        row.status === "active" && nativeCart.items.some((item) => item.id === row.cart_line_item_id && item.metadata.checkout_line_key === row.checkout_line_key)))

    dbBefore = await saveSnapshot([batch.id])
    let afterNativeCompletion = 0
    let conversionFault = false
    const failure = await expectCode("post_native_conversion_failure_preserves_real_order_and_fence",
      "TP08_INJECTED_CONVERSION_FAILURE",
      () => completeReservedCartWithInventory(runtime.container, fixture.authority, {
        event(name, data) { events.push({ name, ...data }) },
        afterNativeCompletion() {
          afterNativeCompletion++
          throw new Error("TP08_NATIVE_COMPLETED_BEFORE_CORRELATION")
        },
        afterConversionAllocation() {
          conversionFault = true
          throw Object.assign(new Error("TP08_INJECTED_CONVERSION_FAILURE"), { code: "TP08_INJECTED_CONVERSION_FAILURE" })
        },
      }))
    const linkedAfterFailure = await findNativeOrdersByCart(knex, fixture.cart.id)
    const fencedAfterFailure = await adminPg.query(`SELECT attempt_status,order_correlation_status,order_id FROM cart_checkout_attempt
      WHERE checkout_attempt_id=$1::uuid`, [fixture.authority.attemptId])
    const reservationsAfterFailure = await reservationsFor(fixture.authority.attemptId)
    const allocationsAfterFailure = await adminPg.query("SELECT id FROM order_batch_allocation WHERE order_id=$1", [linkedAfterFailure[0]?.id])
    check("native_workflow_uncertainty_reconciles_from_real_cart_order_link", 1, linkedAfterFailure,
      afterNativeCompletion === 1 && linkedAfterFailure.length === 1 && linkedAfterFailure[0].cart_id === fixture.cart.id)
    check("conversion_failure_keeps_order_correlated_and_stock_reserved", true, {
      error: failure?.message, conversionFault, attempt: fencedAfterFailure.rows[0],
      reservations: reservationsAfterFailure.map((row) => ({ id: row.id, status: row.status })),
      allocationCount: allocationsAfterFailure.rowCount,
    }, conversionFault && fencedAfterFailure.rows[0]?.attempt_status === "order_created" &&
      fencedAfterFailure.rows[0]?.order_correlation_status === "correlated" &&
      fencedAfterFailure.rows[0]?.order_id === linkedAfterFailure[0]?.id &&
      reservationsAfterFailure.length === 2 && reservationsAfterFailure.every((row) => row.status === "active") &&
      allocationsAfterFailure.rowCount === 0)
    const lockSequence = events.filter((event) => ["order_advisory_lock_acquired", "conversion_session_locked",
      "conversion_attempt_locked", "conversion_batches_locked_ascending", "conversion_reservations_locked"].includes(event.name))
      .map((event) => event.name)
    check("revision18_order_root_lock_precedes_authority_batches_and_reservations", [
      "order_advisory_lock_acquired", "conversion_session_locked", "conversion_attempt_locked",
      "conversion_batches_locked_ascending", "conversion_reservations_locked",
    ], lockSequence, JSON.stringify(lockSequence) === JSON.stringify([
      "order_advisory_lock_acquired", "conversion_session_locked", "conversion_attempt_locked",
      "conversion_batches_locked_ascending", "conversion_reservations_locked",
    ]))

    let recoveryWorkflowCalls = 0
    const recovered = await completeReservedCartWithInventory(runtime.container, fixture.authority, {
      afterNativeCompletion() { recoveryWorkflowCalls++ },
    })
    check("correlated_order_recovery_skips_native_creation", 0, recoveryWorkflowCalls, recoveryWorkflowCalls === 0)
    const order = await runtime.container.resolve(Modules.ORDER).retrieveOrder(recovered.orderId, { relations: ["items", "items.detail"] })
    const nativeOrders = await findNativeOrdersByCart(knex, fixture.cart.id)
    dbAfter = await saveSnapshot([batch.id])
    const orderLines = order.items || []
    const allocations = dbAfter.allocations.filter((row) => row.order_id === recovered.orderId)
    const conversionMovements = dbAfter.movements.filter((row) => row.reference_id === recovered.orderId && row.movement_type === "allocation_conversion")
    const nativeReservations = dbAfter.reservations.filter((row) => row.checkout_attempt_id === fixture.authority.attemptId)
    check("actual_complete_cart_workflow_created_one_native_order", 1,
      { cartId: fixture.cart.id, orderId: recovered.orderId, links: nativeOrders },
      nativeOrders.length === 1 && nativeOrders[0].id === recovered.orderId && nativeOrders[0].cart_id === fixture.cart.id)
    check("native_order_preserves_line_identity_and_checkout_keys", 2,
      orderLines.map((line) => ({ id: line.id, quantity: line.detail?.quantity, key: line.metadata?.checkout_line_key })),
      orderLines.length === 2 && orderLines.every((line) => nativeCart.items.some((item) =>
        item.metadata.checkout_line_key === line.metadata?.checkout_line_key && Number(item.quantity) === Number(line.detail?.quantity))))
    check("real_order_allocations_and_movement_ledger_match_reservations", 2,
      { reservations: nativeReservations.map((row) => ({ id: row.id, status: row.status })),
        allocations: allocations.map((row) => ({ id: row.id, line: row.line_item_id, key: row.checkout_line_key, quantity: row.quantity_allocated })),
        movements: conversionMovements.map((row) => ({ id: row.id, batch: row.batch_id, reference: row.reference_id })) },
      recovered.conversionStatus === "allocated" && allocations.length === 2 && conversionMovements.length === 2 &&
      nativeReservations.every((row) => row.status === "converted") && allocations.every((row) =>
        nativeReservations.some((reservation) => reservation.checkout_line_key === row.checkout_line_key &&
          Number(reservation.quantity) === Number(row.quantity_allocated) && reservation.cart_line_item_id !== null)))

    const beforeReplay = { batch: dbAfter.batches.find((row) => row.id === batch.id), allocations: allocations.length, movements: conversionMovements.length }
    let replayWorkflowCalls = 0
    const replay = await completeReservedCartWithInventory(runtime.container, fixture.authority, {
      afterNativeCompletion() { replayWorkflowCalls++ },
    })
    const afterReplay = await saveSnapshot([batch.id])
    const replayAllocations = afterReplay.allocations.filter((row) => row.order_id === recovered.orderId)
    const replayMovements = afterReplay.movements.filter((row) => row.reference_id === recovered.orderId && row.movement_type === "allocation_conversion")
    check("exact_native_checkout_replay_is_read_only", true,
      { first: recovered, replay, before: beforeReplay, after: { batch: afterReplay.batches.find((row) => row.id === batch.id),
        allocations: replayAllocations.length, movements: replayMovements.length } },
      replay.replayed && replay.orderId === recovered.orderId && replayWorkflowCalls === 0 &&
        replayAllocations.length === beforeReplay.allocations && replayMovements.length === beforeReplay.movements &&
        JSON.stringify(afterReplay.batches.find((row) => row.id === batch.id)) === JSON.stringify(beforeReplay.batch))

    const concurrentFixture = await makeCart([{ quantity: 1 }], "parallel-native-completions")
    await new InventoryLedger(runtime.container).reserveCart(concurrentFixture.authority)
    let nativeCompletionCalls = 0
    const concurrentResults = await Promise.allSettled([
      completeReservedCartWithInventory(runtime.container, concurrentFixture.authority, {
        afterNativeCompletion() { nativeCompletionCalls++ },
      }),
      completeReservedCartWithInventory(runtime.container, concurrentFixture.authority, {
        afterNativeCompletion() { nativeCompletionCalls++ },
      }),
    ])
    const concurrentOrders = await findNativeOrdersByCart(knex, concurrentFixture.cart.id)
    const concurrentState = await adminPg.query(`SELECT attempt_status,order_id FROM cart_checkout_attempt
      WHERE checkout_attempt_id=$1::uuid`, [concurrentFixture.authority.attemptId])
    const concurrentAllocationCount = await adminPg.query("SELECT count(*)::int AS n FROM order_batch_allocation WHERE order_id=$1", [concurrentOrders[0]?.id])
    const concurrentMovementCount = await adminPg.query("SELECT count(*)::int AS n FROM inventory_movement WHERE reference_id=$1 AND movement_type='allocation_conversion'", [concurrentOrders[0]?.id])
    check("concurrent_real_native_requests_produce_one_workflow_order_and_allocation_set", true,
      { nativeCompletionCalls, results: concurrentResults.map((result) => result.status === "fulfilled" ? result.value : { error: result.reason?.message }),
        orders: concurrentOrders, attempt: concurrentState.rows[0], allocations: concurrentAllocationCount.rows[0]?.n,
        conversionMovements: concurrentMovementCount.rows[0]?.n },
      nativeCompletionCalls === 1 && concurrentOrders.length === 1 &&
        concurrentState.rows[0]?.attempt_status === "allocated" && concurrentState.rows[0]?.order_id === concurrentOrders[0]?.id &&
        concurrentAllocationCount.rows[0]?.n === 1 && concurrentMovementCount.rows[0]?.n === 1)

    const noOrderFixture = await makeCart([{ quantity: 1 }], "native-workflow-no-payment-session", 1000)
    await new InventoryLedger(runtime.container).reserveCart(noOrderFixture.authority)
    let nativeInvocationAttempts = 0
    const unresolved = await completeReservedCartWithInventory(runtime.container, noOrderFixture.authority, {
      beforeNativeCompletion() { nativeInvocationAttempts++ },
    })
    const unresolvedOrders = await findNativeOrdersByCart(knex, noOrderFixture.cart.id)
    const unresolvedAttempt = await adminPg.query(`SELECT attempt_status,order_correlation_status,order_id FROM cart_checkout_attempt
      WHERE checkout_attempt_id=$1::uuid`, [noOrderFixture.authority.attemptId])
    const unresolvedRetry = await completeReservedCartWithInventory(runtime.container, noOrderFixture.authority, {
      beforeNativeCompletion() { nativeInvocationAttempts++ },
    })
    check("zero_native_orders_keep_fence_without_second_workflow_invocation", true,
      { unresolved, retry: unresolvedRetry, nativeInvocationAttempts, nativeOrders: unresolvedOrders, attempt: unresolvedAttempt.rows[0] },
      unresolved.conversionStatus === "pending_reconciliation" && unresolvedRetry.conversionStatus === "pending_reconciliation" &&
        nativeInvocationAttempts === 1 && unresolvedOrders.length === 0 && unresolvedAttempt.rows[0]?.order_id === null &&
        unresolvedAttempt.rows[0]?.attempt_status === "needs_reconciliation" &&
        unresolvedAttempt.rows[0]?.order_correlation_status === "needs_reconciliation")
    status = "passed"
  }

  if (tpId === "TP-24c") {
    const now = await knex.raw("SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser")
    const roleState = now.rows[0]
    check("app_connection_is_nonsuperuser_session", { current_user: "medusa_app", superuser: false }, roleState,
      roleState.current_user === "medusa_app" && roleState.session_user === "medusa_app" && roleState.is_superuser === false)
    const variant = await productService.createProducts({ title: "Ledger immutability fixture " + randomUUID(), options: [], variants: [{ title: "Fixture", manage_inventory: false }] })
    const v = (await productService.listProductVariants({ product_id: variant.id }))[0]
    const batchId = "bat_" + randomUUID(), op = randomUUID(), movementId = "mov_" + randomUUID()
    await adminPg.query(`INSERT INTO inventory_batch(id,variant_id,location_id,supplier_id,batch_number,supplier_invoice_reference,receipt_operation_id,
      expiration_date,quantity_on_hand,purchase_currency,purchase_price_raw,exchange_rate_to_egp,unit_cost_purchase,unit_cost_final)
      VALUES($1,$2,$3,$4,'immutability','fixture',$5::uuid,CURRENT_DATE+60,1,'EGP',10,1,10,10)`, [batchId,v.id,locationId,supplierId,op])
    const key = movementDedupKey("receipt", batchId, "receipt", op)
    await adminPg.query(`INSERT INTO inventory_movement(id,deduplication_key,batch_id,variant_id,movement_type,quantity_on_hand_delta,
      quantity_reserved_delta,quantity_quarantined_delta,quantity_on_hand_before,quantity_on_hand_after,quantity_reserved_before,quantity_reserved_after,
      quantity_quarantined_before,quantity_quarantined_after,reference_type,reference_id,actor_id)
      VALUES($1,$2,$3,$4,'receipt',1,0,0,0,1,0,0,0,0,'receipt',$5,'fixture')`, [movementId,key,batchId,v.id,op])
    dbBefore = { ledger: (await adminPg.query("SELECT * FROM inventory_movement WHERE id=$1", [movementId])).rows }
    const privs = await knex.raw(`SELECT has_table_privilege(current_user,'inventory_movement','UPDATE') AS can_update,
      has_table_privilege(current_user,'inventory_movement','DELETE') AS can_delete,
      has_table_privilege(current_user,'inventory_movement','TRUNCATE') AS can_truncate`)
    check("medusa_app_lacks_mutation_privileges", { can_update: false, can_delete: false, can_truncate: false }, privs.rows[0],
      !privs.rows[0].can_update && !privs.rows[0].can_delete && !privs.rows[0].can_truncate)
    for (const [operation, sql] of [
      ["UPDATE", "UPDATE inventory_movement SET actor_id='tampered' WHERE id=?"],
      ["DELETE", "DELETE FROM inventory_movement WHERE id=?"],
      ["TRUNCATE", "TRUNCATE inventory_movement"],
    ]) await expectCode("medusa_app_denied_" + operation.toLowerCase(), "42501", () => knex.raw(sql, operation === "TRUNCATE" ? [] : [movementId]))
    for (const [operation, sql] of [
      ["UPDATE", "UPDATE inventory_movement SET actor_id='tampered' WHERE id=?"],
      ["DELETE", "DELETE FROM inventory_movement WHERE id=?"],
    ]) {
      if (!probePg) { probePg = createPgClient(pgUrlAsRole(isolatedUrl, probeRole, probePassword)); await probePg.connect() }
      const writer = await probePg.query("SELECT current_user,session_user,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser")
      check("separate_writer_is_nonsuperuser_nonowner", { role: probeRole, superuser: false }, writer.rows[0],
        writer.rows[0].current_user === probeRole && writer.rows[0].session_user === probeRole && writer.rows[0].is_superuser === false)
      const writerSql = sql.replaceAll("?", "$1")
      await expectCode("nonowner_writer_trigger_blocks_" + operation.toLowerCase(), "P0001", () => probePg.query(writerSql, [movementId]),
        (error) => String(error.message).includes("INVENTORY_MOVEMENT_IMMUTABLE"))
    }
    const current = await adminPg.query("SELECT * FROM inventory_movement WHERE id=$1", [movementId])
    dbAfter = { ledger: current.rows }
    check("mutation_attempts_leave_ledger_unchanged", dbBefore, dbAfter, JSON.stringify(dbBefore) === JSON.stringify(dbAfter))
    check("row_trigger_and_role_ownership_are_independent", true, { tableOwner: (await adminPg.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname='inventory_movement'")).rows[0].owner, writerRole: probeRole },
      (await adminPg.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname='inventory_movement'")).rows[0].owner !== probeRole)
    status = "passed"
  }

  if (tpId === "TP-06a") {
    const boundary = await makeBatch(100, 30, "boundary")
    const first = await makeBatch(10, 31, "fefo-first")
    const later = await makeBatch(10, 60, "fefo-later")
    const fixture = await makeCart([{ quantity: 2 }, { quantity: 3 }], "two-lines-one-lot")
    dbBefore = await saveSnapshot([boundary.id, first.id, later.id])
    const result = await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
    dbAfter = await saveSnapshot([boundary.id, first.id, later.id])
    const cbr = dbAfter.reservations.filter((row) => row.checkout_attempt_id === fixture.authority.attemptId)
    const moves = dbAfter.movements.filter((row) => cbr.some((reservation) => reservation.id === row.reference_id && row.movement_type === "reservation"))
    const sorted = [...cbr].sort((a,b) => a.quantity-b.quantity)
    check("two_distinct_line_reservations_same_fefo_batch", 2, cbr.length === 2 && new Set(cbr.map((r) => r.checkout_line_key)).size === 2 && cbr.every((r) => r.batch_id === first.id) && result.length === 2 ? cbr.map((r) => ({id:r.id,key:r.checkout_line_key,batch:r.batch_id,quantity:r.quantity})) : cbr, cbr.length === 2 && new Set(cbr.map((r) => r.checkout_line_key)).size === 2 && cbr.every((r) => r.batch_id === first.id) && result.length === 2)
    check("requested_quantities_are_two_and_three", [2,3], sorted.map((r) => r.quantity), JSON.stringify(sorted.map((r) => r.quantity)) === "[2,3]")
    check("two_distinct_canonical_reservation_movements", { count: 2, distinctKeys: 2 }, { count: moves.length, distinctKeys: new Set(moves.map((m) => m.deduplication_key)).size }, moves.length === 2 && new Set(moves.map((m) => m.deduplication_key)).size === 2 && moves.every((m) => m.reference_type === "cart_reservation"))
    check("reservation_movement_snapshots_and_ledger_ids", true, moves.map((m) => ({ref:m.reference_id,delta:m.quantity_reserved_delta,before:m.quantity_reserved_before,after:m.quantity_reserved_after,key:m.deduplication_key})),
      moves.every((m) => { const r=cbr.find((x)=>x.id===m.reference_id); return r && m.quantity_reserved_delta===r.quantity && m.quantity_reserved_after===m.quantity_reserved_before+r.quantity && m.deduplication_key===movementDedupKey("reservation",first.id,"cart_reservation",r.id) }))
    const selected = dbAfter.batches.find((b) => b.id === first.id)
    check("batch_balance_available_and_cost_snapshots", { onHand: 10, reserved: 5, available: 5, cost: "12.0000" },
      { onHand: selected.quantity_on_hand, reserved: selected.quantity_reserved, available: selected.quantity_on_hand-selected.quantity_reserved-selected.quantity_quarantined,
        costs: cbr.map((r) => r.unit_cost_snapshot) }, selected.quantity_on_hand === 10 && selected.quantity_reserved === 5 && cbr.every((r) => String(r.unit_cost_snapshot) === "12.0000"))
    check("strict_cairo_fefo_boundary_and_unselected_lot_unchanged", true,
      { boundaryReserved: dbAfter.batches.find((b)=>b.id===boundary.id).quantity_reserved, laterReserved:dbAfter.batches.find((b)=>b.id===later.id).quantity_reserved },
      dbAfter.batches.find((b)=>b.id===boundary.id).quantity_reserved===0 && dbAfter.batches.find((b)=>b.id===later.id).quantity_reserved===0)
    status = "passed"
  }

  if (tpId === "TP-06b") {
    const batch = await makeBatch(30, 90, "replay")
    const fixture = await makeCart([{ quantity: 2 }], "replay-and-conflict")
    const ledger = new InventoryLedger(runtime.container)
    await ledger.reserveCart(fixture.authority)
    dbBefore = await saveSnapshot([batch.id])
    const replay = await ledger.reserveCart(fixture.authority)
    dbAfter = await saveSnapshot([batch.id])
    check("exact_replay_returns_original_reservation_and_movement", true, replay.map((x)=>({reservation:x.reservation.id,movement:x.movement.id,replay:x.replay})),
      replay.length===1 && replay[0].replay && replay[0].reservation.id===dbBefore.reservations[0].id && replay[0].movement.id===dbBefore.movements.find((m)=>m.reference_id===dbBefore.reservations[0].id).id)
    check("exact_replay_has_zero_database_writes", true, {beforeCounts:Object.fromEntries(Object.entries(dbBefore).map(([k,v])=>[k,v.length])), afterCounts:Object.fromEntries(Object.entries(dbAfter).map(([k,v])=>[k,v.length]))}, JSON.stringify(dbBefore)===JSON.stringify(dbAfter))
    await adminPg.query("UPDATE cart_line_item SET quantity=3 WHERE id=$1", [fixture.lines[0].id])
    await expectCode("same_identity_changed_quantity_is_conflict", "RESERVATION_INTENT_CONFLICT", () => ledger.reserveCart(fixture.authority))
    await adminPg.query("UPDATE cart_line_item SET quantity=2 WHERE id=$1", [fixture.lines[0].id])
    const missing = await makeCart([{ quantity: 2 }], "missing-movement")
    const missingLine = missing.lines[0]
    const missingReservationId = "cbr_" + randomUUID()
    await adminPg.query(`INSERT INTO cart_batch_reservation(id,checkout_attempt_id,cart_id,checkout_line_key,checkout_epoch,cart_line_item_id,variant_id,batch_id,quantity,unit_cost_snapshot,status,expires_at)
      VALUES($1,$2::uuid,$3,$4::uuid,1,$5,$6,$7,2,'12.0000','active',NOW()+INTERVAL '15 minutes')`, [missingReservationId,missing.authority.attemptId,missing.cart.id,missingLine.metadata.checkout_line_key,missingLine.id,variantId,batch.id])
    await adminPg.query("UPDATE cart_checkout_attempt SET attempt_status='reserved' WHERE checkout_attempt_id=$1",[missing.authority.attemptId])
    await expectCode("reservation_without_movement_is_divergence", "INVENTORY_LEDGER_DIVERGENCE", () => new InventoryLedger(runtime.container).reserveCart(missing.authority))
    const faultBatch = await makeBatch(10, 95, "fault")
    const faultFixture = await makeCart([{ quantity: 3 }], "ledger-insert-failure")
    const faultBefore = await saveSnapshot([faultBatch.id])
    let injected = false
    const failing = new InventoryLedger(runtime.container, { afterBalanceUpdate() { injected = true; throw Object.assign(new Error("injected ledger insert boundary"), { code: "TP06B_INJECTED_LEDGER_FAILURE" }) } })
    await expectCode("fault_injected_after_balance_before_ledger", "TP06B_INJECTED_LEDGER_FAILURE", () => failing.reserveCart(faultFixture.authority))
    const faultAfter = await saveSnapshot([faultBatch.id])
    check("fault_rolls_back_batch_reservation_and_ledger_atomically", true, { injected, before: faultBefore, after: faultAfter }, injected && JSON.stringify(faultBefore)===JSON.stringify(faultAfter))

    await adminPg.query("UPDATE inventory_batch SET status='exhausted' WHERE variant_id=$1", [variantId])
    const sameBatch = await makeBatch(10, 98, "same-intent-race")
    const sameFixture = await makeCart([{quantity:4}], "same-intent-race")
    let sameEntered, sameRelease
    const sameAtUpdate=new Promise((resolve)=>{sameEntered=resolve}), sameGate=new Promise((resolve)=>{sameRelease=resolve})
    const sameLeftEvents=[], sameRightEvents=[]
    const sameLeft=new InventoryLedger(runtime.container,{event:(name,data)=>sameLeftEvents.push({name,...data}),afterBalanceUpdate:async()=>{sameEntered();await sameGate}})
    const sameRight=new InventoryLedger(runtime.container,{event:(name,data)=>sameRightEvents.push({name,...data})})
    const sameLeftPromise=sameLeft.reserveCart(sameFixture.authority)
    await waitUntil(()=>sameLeftEvents.some((e)=>e.name==="transaction_started"),"first same-intent transaction"); await sameAtUpdate
    const sameRightPromise=sameRight.reserveCart(sameFixture.authority)
    try {
      await waitUntil(()=>sameRightEvents.some((e)=>e.name==="transaction_started"),"second same-intent transaction")
      const leftPid=sameLeftEvents.find((e)=>e.name==="transaction_started").pid, rightPid=sameRightEvents.find((e)=>e.name==="transaction_started").pid
      let blockers=[]
      await waitUntil(async()=>{blockers=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[rightPid])).rows[0].blockers;return blockers.includes(leftPid)},"same-cart authority row lock")
      check("same_intent_requests_use_distinct_blocked_backends",true,{leftPid,rightPid,blockers},leftPid!==rightPid&&blockers.includes(leftPid))
    } finally { sameRelease() }
    const [sameLeftResult,sameRightResult]=await Promise.all([sameLeftPromise,sameRightPromise])
    const sameRows=await adminPg.query("SELECT id,quantity,batch_id FROM cart_batch_reservation WHERE checkout_attempt_id=$1 ORDER BY id",[sameFixture.authority.attemptId])
    const sameMoves=await adminPg.query("SELECT id,reference_id FROM inventory_movement WHERE reference_type='cart_reservation' AND reference_id=ANY($1::text[])",[sameRows.rows.map((r)=>r.id)])
    const sameBalance=(await adminPg.query("SELECT quantity_reserved FROM inventory_batch WHERE id=$1",[sameBatch.id])).rows[0].quantity_reserved
    check("concurrent_exact_replay_reuses_one_reservation_and_movement",true,{first:sameLeftResult.map((r)=>({id:r.reservation.id,replay:r.replay})),second:sameRightResult.map((r)=>({id:r.reservation.id,replay:r.replay})),reservations:sameRows.rows,movements:sameMoves.rows,reserved:sameBalance},
      sameRows.rowCount===1&&sameMoves.rowCount===1&&sameBalance===4&&sameLeftResult[0].reservation.id===sameRightResult[0].reservation.id&&sameLeftResult[0].replay!==sameRightResult[0].replay)

    await adminPg.query("UPDATE inventory_batch SET status='exhausted' WHERE variant_id=$1", [variantId])
    const concurrentBatch = await makeBatch(10, 100, "capacity-race")
    const left = await makeCart([{quantity:8}], "capacity-race-left"), right = await makeCart([{quantity:8}], "capacity-race-right")
    let entered, release
    const atUpdate = new Promise((resolve)=>{entered=resolve}), gate = new Promise((resolve)=>{release=resolve})
    const leftEvents=[], rightEvents=[]
    const leftLedger = new InventoryLedger(runtime.container,{event:(name,data)=>leftEvents.push({name,...data}),afterBalanceUpdate:async()=>{entered();await gate}})
    const rightLedger = new InventoryLedger(runtime.container,{event:(name,data)=>rightEvents.push({name,...data})})
    const leftPromise=leftLedger.reserveCart(left.authority)
    await waitUntil(()=>leftEvents.some((e)=>e.name==="transaction_started"),"first inventory transaction")
    await atUpdate
    const rightPromise=rightLedger.reserveCart(right.authority).then((value)=>({ok:true,value}), (error)=>({ok:false,error}))
    try {
      await waitUntil(()=>rightEvents.some((e)=>e.name==="transaction_started"),"second inventory transaction")
      const leftPid=leftEvents.find((e)=>e.name==="transaction_started").pid, rightPid=rightEvents.find((e)=>e.name==="transaction_started").pid
      check("capacity_race_uses_distinct_postgres_backends", true,{leftPid,rightPid},leftPid!==rightPid)
      let blocking=[]
      await waitUntil(async()=>{blocking=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[rightPid])).rows[0].blockers;return blocking.includes(leftPid)},"real batch-row lock wait")
      events.push({event:"capacity_batch_row_lock_wait",leftPid,rightPid,blockingPids:blocking,at:new Date().toISOString()})
      check("capacity_race_observed_real_postgres_blocker", leftPid, blocking, blocking.includes(leftPid))
    } finally { release() }
    const leftResult=await leftPromise, rightResult=await rightPromise
    check("capacity_race_prevents_oversell", {oneWinner:true,reserved:8}, {left: "committed", right: rightResult.ok?"committed":rightResult.error.message, reserved:(await adminPg.query("SELECT quantity_reserved FROM inventory_batch WHERE id=$1",[concurrentBatch.id])).rows[0].quantity_reserved}, !rightResult.ok && leftResult.length===1 && (await adminPg.query("SELECT quantity_reserved FROM inventory_batch WHERE id=$1",[concurrentBatch.id])).rows[0].quantity_reserved===8)
    status="passed"
  }

  if (tpId === "TP-07a") {
    const batch = await makeBatch(20, 90, "cleanup")
    const fixture = await makeCart([{quantity:3}], "expired-cleanup-race")
    await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
    const reservationId=(await adminPg.query("SELECT id FROM cart_batch_reservation WHERE checkout_attempt_id=$1",[fixture.authority.attemptId])).rows[0].id
    await adminPg.query("UPDATE cart_batch_reservation SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[reservationId])
    dbBefore = await saveSnapshot([batch.id])
    const oneEvents=[], twoEvents=[]
    let entered,release
    const atUpdate=new Promise((resolve)=>{entered=resolve}),gate=new Promise((resolve)=>{release=resolve})
    const first=new InventoryLedger(runtime.container,{event:(name,data)=>oneEvents.push({name,...data}),afterBalanceUpdate:async()=>{entered();await gate}})
    const second=new InventoryLedger(runtime.container,{event:(name,data)=>twoEvents.push({name,...data})})
    const firstPromise=first.cleanupExpired(fixture.authority)
    await waitUntil(()=>oneEvents.some((e)=>e.name==="transaction_started"),"first cleanup transaction"); await atUpdate
    const secondPromise=second.cleanupExpired(fixture.authority)
    try {
      await waitUntil(()=>twoEvents.some((e)=>e.name==="transaction_started"),"second cleanup transaction")
      const firstPid=oneEvents.find((e)=>e.name==="transaction_started").pid, secondPid=twoEvents.find((e)=>e.name==="transaction_started").pid
      let blockers=[]
      await waitUntil(async()=>{blockers=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[secondPid])).rows[0].blockers;return blockers.includes(firstPid)},"cleanup authority row lock")
      events.push({event:"cleanup_worker_interleaving",firstPid,secondPid,blockingPids:blockers,at:new Date().toISOString()})
      check("two_cleanup_workers_are_distinct_and_serialized",true,{firstPid,secondPid,blockers},firstPid!==secondPid&&blockers.includes(firstPid))
    } finally { release() }
    const [firstResult,secondResult]=await Promise.all([firstPromise,secondPromise])
    const after=await saveSnapshot([batch.id]); dbAfter=after
    const row=after.reservations.find((r)=>r.id===reservationId), releaseMoves=after.movements.filter((m)=>m.reference_id===reservationId&&m.movement_type==="reservation_release")
    check("expired_reservation_release_is_atomic_once",{status:"expired",reserved:0,movements:1},{status:row.status,reserved:after.batches.find((b)=>b.id===batch.id).quantity_reserved,movements:releaseMoves.length},row.status==="expired"&&after.batches.find((b)=>b.id===batch.id).quantity_reserved===0&&releaseMoves.length===1)
    check("second_cleanup_is_zero_write_replay",true,{first:firstResult.map((x)=>x.replay),second:secondResult.map((x)=>x.replay)},firstResult.length===1&&secondResult.length===1&&firstResult[0].replay===false&&secondResult[0].replay===true)
    await adminPg.query("UPDATE cart_batch_reservation SET status='active' WHERE id=$1",[reservationId])
    await expectCode("active_reservation_with_release_movement_is_divergence","INVENTORY_LEDGER_DIVERGENCE",()=>new InventoryLedger(runtime.container).cleanupExpired(fixture.authority))
    await adminPg.query("UPDATE cart_batch_reservation SET status='expired' WHERE id=$1",[reservationId])
    const noMovement=await makeCart([{quantity:2}],"expired-without-release")
    await new InventoryLedger(runtime.container).reserveCart(noMovement.authority)
    const noMoveId=(await adminPg.query("SELECT id FROM cart_batch_reservation WHERE checkout_attempt_id=$1",[noMovement.authority.attemptId])).rows[0].id
    await adminPg.query("UPDATE cart_batch_reservation SET expires_at=NOW()-INTERVAL '1 second',status='expired' WHERE id=$1",[noMoveId])
    await expectCode("expired_reservation_without_release_movement_is_divergence","INVENTORY_LEDGER_DIVERGENCE",()=>new InventoryLedger(runtime.container).cleanupExpired(noMovement.authority))
    const conflictFixture=await makeCart([{quantity:2}],"conflicting-release-key")
    await new InventoryLedger(runtime.container).reserveCart(conflictFixture.authority)
    const conflictRow=(await adminPg.query("SELECT * FROM cart_batch_reservation WHERE checkout_attempt_id=$1",[conflictFixture.authority.attemptId])).rows[0]
    await adminPg.query("UPDATE cart_batch_reservation SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[conflictRow.id])
    const releaseKey=movementDedupKey("reservation_release",batch.id,"cleanup",conflictRow.id)
    await adminPg.query(`INSERT INTO inventory_movement(id,deduplication_key,batch_id,variant_id,movement_type,quantity_on_hand_delta,
      quantity_reserved_delta,quantity_quarantined_delta,quantity_on_hand_before,quantity_on_hand_after,quantity_reserved_before,quantity_reserved_after,
      quantity_quarantined_before,quantity_quarantined_after,reference_type,reference_id,actor_id)
      VALUES($1,$2,$3,$4,'reservation_release',0,-2,0,20,20,5,3,0,0,'cleanup',$5,'tampered')`,["mov_"+randomUUID(),releaseKey,batch.id,variantId,conflictRow.id])
    await expectCode("conflicting_movement_semantics_are_409","INVENTORY_MOVEMENT_INTENT_CONFLICT",()=>new InventoryLedger(runtime.container).cleanupExpired(conflictFixture.authority))
    status="passed"
  }

  if (tpId === "TP-09") {
    const batch = await makeBatch(30, 90, "conversion-lines")
    const fixture = await makeCart([{quantity:2},{quantity:3}], "same-variant-distinct-line-keys")
    await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
    const reservations = await reservationsFor(fixture.authority.attemptId)
    const order = await makeNativeOrder(fixture)
    dbBefore = await saveSnapshot([batch.id])
    const result = await convert(fixture, order, reservations.map((row)=>row.id))
    dbAfter = await saveSnapshot([batch.id])
    const allocations = dbAfter.allocations.filter((row)=>row.order_id===order.id)
    const orderLines = (await runtime.container.resolve(Modules.ORDER).retrieveOrder(order.id,{relations:["items","items.detail"]})).items
    check("native_order_fixture_uses_two_distinct_checkout_line_keys",2,{keys:orderLines.map((line)=>line.metadata?.checkout_line_key),quantities:orderLines.map((line)=>line.detail?.quantity)},
      orderLines.length===2&&new Set(orderLines.map((line)=>line.metadata?.checkout_line_key)).size===2&&new Set(orderLines.map((line)=>Number(line.detail?.quantity))).size===2)
    check("allocations_deterministically_map_native_order_lines",true,allocations.map((row)=>({key:row.checkout_line_key,line:row.line_item_id,quantity:row.quantity_allocated})),
      allocations.length===2&&allocations.every((row)=>reservations.some((reservation)=>reservation.checkout_line_key===row.checkout_line_key&&Number(reservation.quantity)===Number(row.quantity_allocated)&&reservation.variant_id===variantId)&&orderLines.some((line)=>line.id===row.line_item_id&&line.metadata.checkout_line_key===row.checkout_line_key)))
    check("conversion_returns_authoritative_order_version_and_ids",true,{version:result.orderVersion,allocations:result.allocations.map((row)=>row.id),movements:result.movements.map((row)=>row.id),replay:result.replay},
      result.orderVersion===order.version&&result.allocations.length===2&&result.movements.length===2&&!result.replay)
    const writeCountsBeforeReplay={allocations:dbAfter.allocations.length,movements:dbAfter.movements.length}
    const replay=await convert(fixture,order,reservations.map((row)=>row.id))
    const replaySnapshot=await saveSnapshot([batch.id])
    check("conversion_replay_is_read_only",writeCountsBeforeReplay,{allocations:replaySnapshot.allocations.length,movements:replaySnapshot.movements.length,replay:replay.replay},
      replay.replay&&replaySnapshot.allocations.length===writeCountsBeforeReplay.allocations&&replaySnapshot.movements.length===writeCountsBeforeReplay.movements)

    const omitted=await makeCart([{quantity:1}],"missing-order-line-key")
    await new InventoryLedger(runtime.container).reserveCart(omitted.authority)
    const omittedReservation=await reservationsFor(omitted.authority.attemptId)
    const omittedOrder=await makeNativeOrder(omitted,{omitKey:[0]})
    const beforeMissing=await saveSnapshot([batch.id])
    await expectCode("missing-order-line-key-is-rejected", "UNMAPPED_OR_AMBIGUOUS_LINE_ITEM",()=>convert(omitted,omittedOrder,omittedReservation.map((row)=>row.id)))
    const afterMissing=await saveSnapshot([batch.id])
    check("missing-key-failure-has-no-conversion-writes",true,{allocations:afterMissing.allocations.length-beforeMissing.allocations.length,
      movements:afterMissing.movements.length-beforeMissing.movements.length},afterMissing.allocations.length===beforeMissing.allocations.length&&afterMissing.movements.length===beforeMissing.movements.length)

    const duplicate=await makeCart([{quantity:1},{quantity:1}],"duplicate-order-line-key")
    await new InventoryLedger(runtime.container).reserveCart(duplicate.authority)
    const duplicateReservations=await reservationsFor(duplicate.authority.attemptId)
    const duplicateOrder=await makeNativeOrder(duplicate,{duplicateKey:duplicate.lines[0].metadata.checkout_line_key})
    await expectCode("duplicate-order-line-key-is-ambiguous", "AMBIGUOUS_LINE_MAPPING",()=>convert(duplicate,duplicateOrder,duplicateReservations.map((row)=>row.id)))

    const partial=await makeCart([{quantity:1},{quantity:1}],"partial-validated-set")
    await new InventoryLedger(runtime.container).reserveCart(partial.authority)
    const partialRows=await reservationsFor(partial.authority.attemptId), partialOrder=await makeNativeOrder(partial)
    await expectCode("partial-reservation-id-set-is-rejected", "INCOMPLETE_VALIDATED_RESERVATION_SET",()=>convert(partial,partialOrder,[partialRows[0].id]))
    await expectCode("unknown-reservation-id-is-rejected", "INCOMPLETE_VALIDATED_RESERVATION_SET",()=>convert(partial,partialOrder,[...partialRows.map((row)=>row.id),"cbr_00000000-0000-4000-8000-000000000000"]))

    const released=await makeCart([{quantity:1}],"released-reservation")
    await new InventoryLedger(runtime.container).reserveCart(released.authority)
    const releasedRows=await reservationsFor(released.authority.attemptId), releasedOrder=await makeNativeOrder(released)
    await adminPg.query("UPDATE cart_batch_reservation SET status='released' WHERE id=$1",[releasedRows[0].id])
    const beforeReleased=await saveSnapshot([batch.id])
    await expectCode("released-reservation-is-rejected", "RESERVATION_NOT_ACTIVE",()=>convert(released,releasedOrder,releasedRows.map((row)=>row.id)))
    const afterReleased=await saveSnapshot([batch.id])
    check("released-reservation-negative-set-does-not-write",true,{allocations:afterReleased.allocations.length-beforeReleased.allocations.length,
      conversionMovements:afterReleased.movements.filter((row)=>row.reference_id===releasedOrder.id&&row.movement_type==="allocation_conversion").length},
      afterReleased.allocations.length===beforeReleased.allocations.length&&!afterReleased.movements.some((row)=>row.reference_id===releasedOrder.id&&row.movement_type==="allocation_conversion"))
    status="passed"
  }

  if (tpId === "TP-10") {
    const firstBatch=await makeBatch(3,31,"split-a"), secondBatch=await makeBatch(5,50,"split-b")
    const fixture=await makeCart([{quantity:5}],"single-line-split-across-two-lots")
    await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
    const reservations=await reservationsFor(fixture.authority.attemptId), order=await makeNativeOrder(fixture)
    dbBefore=await saveSnapshot([firstBatch.id,secondBatch.id])
    const result=await convert(fixture,order,reservations.map((row)=>row.id))
    dbAfter=await saveSnapshot([firstBatch.id,secondBatch.id])
    const allocations=dbAfter.allocations.filter((row)=>row.order_id===order.id)
    const movements=dbAfter.movements.filter((row)=>row.reference_id===order.id&&row.movement_type==="allocation_conversion")
    check("one_native_order_line_is_split_three_plus_two",true,allocations.map((row)=>({line:row.line_item_id,batch:row.batch_id,quantity:row.quantity_allocated})),
      allocations.length===2&&new Set(allocations.map((row)=>row.line_item_id)).size===1&&JSON.stringify(allocations.map((row)=>Number(row.quantity_allocated)).sort())==="[2,3]"&&
      allocations.every((row)=>row.line_item_id===result.allocations[0].line_item_id)&&new Set(allocations.map((row)=>row.batch_id)).size===2)
    check("split_allocations_sum_to_native_order_quantity",5,allocations.reduce((sum,row)=>sum+Number(row.quantity_allocated),0),allocations.reduce((sum,row)=>sum+Number(row.quantity_allocated),0)===5)
    check("two_canonical_zero_delta_conversion_movements",2,movements.map((row)=>({key:row.deduplication_key,batch:row.batch_id,reserved:[row.quantity_reserved_before,row.quantity_reserved_after]})),
      movements.length===2&&movements.every((row)=>row.quantity_on_hand_delta===0&&row.quantity_reserved_delta===0&&row.quantity_quarantined_delta===0&&
        row.quantity_on_hand_before===row.quantity_on_hand_after&&row.quantity_reserved_before===row.quantity_reserved_after&&row.quantity_quarantined_before===row.quantity_quarantined_after&&
        row.deduplication_key===movementDedupKey("allocation_conversion",row.batch_id,"order_allocation",order.id,reservations.find((r)=>r.batch_id===row.batch_id).checkout_line_key)))
    const beforeReplay={allocationCount:dbAfter.allocations.length,movementCount:dbAfter.movements.length}
    const replay=await convert(fixture,order,reservations.map((row)=>row.id)), afterReplay=await saveSnapshot([firstBatch.id,secondBatch.id])
    check("split_conversion_exact_replay_has_no_new_rows",beforeReplay,{allocations:afterReplay.allocations.length,movements:afterReplay.movements.length,replay:replay.replay},
      replay.replay&&afterReplay.allocations.length===beforeReplay.allocationCount&&afterReplay.movements.length===beforeReplay.movementCount)

    const rollbackA=await makeBatch(1,32,"rollback-a"),rollbackB=await makeBatch(3,51,"rollback-b")
    const rollbackFixture=await makeCart([{quantity:4}],"rollback-second-allocation")
    await new InventoryLedger(runtime.container).reserveCart(rollbackFixture.authority)
    const rollbackReservations=await reservationsFor(rollbackFixture.authority.attemptId),rollbackOrder=await makeNativeOrder(rollbackFixture)
    const beforeFault=await saveSnapshot([rollbackA.id,rollbackB.id])
    let faultHit=false
    const failing=new InventoryLedger(runtime.container,{afterConversionAllocation(_row,index){if(index===2){faultHit=true;throw Object.assign(new Error("injected second allocation failure"),{code:"TP10_SECOND_ALLOCATION_FAILURE"})}}})
    await expectCode("second-allocation-failure-is-injected","TP10_SECOND_ALLOCATION_FAILURE",()=>failing.convertCartReservationsToAllocations(conversionInput(rollbackFixture,rollbackOrder,rollbackReservations.map((row)=>row.id))))
    const afterFault=await saveSnapshot([rollbackA.id,rollbackB.id])
    check("second-allocation-failure-rolls-back-whole-conversion",true,{faultHit,unchanged:JSON.stringify(beforeFault)===JSON.stringify(afterFault),
      reservations:afterFault.reservations.filter((row)=>row.checkout_attempt_id===rollbackFixture.authority.attemptId).map((row)=>row.status)},
      faultHit&&JSON.stringify(beforeFault)===JSON.stringify(afterFault)&&rollbackReservations.every((row)=>afterFault.reservations.find((r)=>r.id===row.id).status==="active"))
    status="passed"
  }

  if (tpId === "TP-07b") {
    const batch=await makeBatch(40,90,"cleanup-conversion-overlap")
    const beforeConversion=await makeCart([{quantity:3}],"cleanup-starts-first")
    await new InventoryLedger(runtime.container).reserveCart(beforeConversion.authority)
    const beforeRows=await reservationsFor(beforeConversion.authority.attemptId), beforeOrder=await makeNativeOrder(beforeConversion)
    dbBefore=await saveSnapshot([batch.id])
    const blockerClient=createPgClient(isolatedUrl); await blockerClient.connect()
    const holderPid=(await blockerClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await blockerClient.query("BEGIN")
    await blockerClient.query("SELECT cart_id FROM cart_checkout_session WHERE cart_id=$1 FOR UPDATE",[beforeConversion.cart.id])
    const cleanupEvents=[],conversionEvents=[]
    const cleanupPromise=new InventoryLedger(runtime.container,{event:(name,data)=>cleanupEvents.push({name,...data})}).cleanupExpired(beforeConversion.authority).then(()=>null,(error)=>error)
    await waitUntil(()=>cleanupEvents.some((event)=>event.name==="transaction_started"),"cleanup-first transaction")
    const cleanupPid=cleanupEvents.find((event)=>event.name==="transaction_started").pid
    let cleanupBlockers=[]
    await waitUntil(async()=>{cleanupBlockers=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[cleanupPid])).rows[0].blockers;return cleanupBlockers.includes(holderPid)},"cleanup blocked on checkout session")
    const beforeConversionPromise=new InventoryLedger(runtime.container,{event:(name,data)=>conversionEvents.push({name,...data})})
      .convertCartReservationsToAllocations(conversionInput(beforeConversion,beforeOrder,beforeRows.map((row)=>row.id)))
    await waitUntil(()=>conversionEvents.some((event)=>event.name==="transaction_started"),"conversion-first transaction")
    const conversionPid=conversionEvents.find((event)=>event.name==="transaction_started").pid
    let conversionBlockers=[]
    await waitUntil(async()=>{conversionBlockers=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[conversionPid])).rows[0].blockers;return conversionBlockers.includes(cleanupPid)},"conversion blocked on cleanup order root")
    events.push({event:"cleanup_started_before_order_conversion",holderPid,cleanupPid,conversionPid,cleanupBlockers,conversionBlockers,at:new Date().toISOString()})
    await blockerClient.query("COMMIT"); await blockerClient.end()
    const cleanFirstError=await cleanupPromise
    const firstConversion=await beforeConversionPromise
    check("cleanup-first-on-correlated-attempt-stops-without-release","ORDER_CONVERSION_PENDING",cleanFirstError?.message,Boolean(cleanFirstError?.message?.includes("ORDER_CONVERSION_PENDING")))
    check("cleanup-first-race-converts-only-after-root-lock",true,{converted:firstConversion.allocations.length,cleanupBlockers,conversionBlockers},
      firstConversion.allocations.length===1&&cleanupBlockers.includes(holderPid)&&conversionBlockers.includes(cleanupPid))
    const afterBefore=await saveSnapshot([batch.id])
    check("cleanup-first-race-never-releases-converted-stock",0,afterBefore.movements.filter((row)=>row.reference_id===beforeRows[0].id&&row.movement_type==="reservation_release").length&&
      afterBefore.reservations.find((row)=>row.id===beforeRows[0].id).status==="converted"?0:1,
      !afterBefore.movements.some((row)=>row.reference_id===beforeRows[0].id&&row.movement_type==="reservation_release")&&afterBefore.reservations.find((row)=>row.id===beforeRows[0].id).status==="converted")

    const conversionFirst=await makeCart([{quantity:2}],"conversion-starts-first")
    await new InventoryLedger(runtime.container).reserveCart(conversionFirst.authority)
    const conversionFirstRows=await reservationsFor(conversionFirst.authority.attemptId),conversionFirstOrder=await makeNativeOrder(conversionFirst)
    let continueConversion,conversionAtReservations
    const conversionGate=new Promise((resolve)=>{continueConversion=resolve}), conversionEntered=new Promise((resolve)=>{conversionAtReservations=resolve})
    const firstEvents=[],cleanupAfterEvents=[]
    const firstConversionPromise=new InventoryLedger(runtime.container,{event:async(name,data)=>{firstEvents.push({name,...data});if(name==="conversion_reservations_locked"){conversionAtReservations();await conversionGate}}})
      .convertCartReservationsToAllocations(conversionInput(conversionFirst,conversionFirstOrder,conversionFirstRows.map((row)=>row.id)))
    await conversionEntered
    const cleanupAfterPromise=new InventoryLedger(runtime.container,{event:(name,data)=>cleanupAfterEvents.push({name,...data})}).cleanupExpired(conversionFirst.authority)
    await waitUntil(()=>cleanupAfterEvents.some((event)=>event.name==="transaction_started"),"cleanup waiting behind conversion")
    const cleanupAfterPid=cleanupAfterEvents.find((event)=>event.name==="transaction_started").pid
    const firstConversionPid=firstEvents.find((event)=>event.name==="transaction_started").pid
    let cleanupAfterBlockers=[]
    await waitUntil(async()=>{cleanupAfterBlockers=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[cleanupAfterPid])).rows[0].blockers;return cleanupAfterBlockers.includes(firstConversionPid)},"cleanup blocked on order advisory root")
    events.push({event:"conversion_started_before_cleanup",conversionPid:firstConversionPid,cleanupPid:cleanupAfterPid,blockingPids:cleanupAfterBlockers,at:new Date().toISOString()})
    continueConversion()
    const conversionFirstResult=await firstConversionPromise
    const cleanupAfterError=await cleanupAfterPromise.then(()=>null,(error)=>error)
    check("conversion-first-cleanup-takes-order-root-before-session",true,firstEvents.map((event)=>event.name),
      firstEvents.indexOf(firstEvents.find((event)=>event.name==="order_advisory_lock_acquired"))<firstEvents.indexOf(firstEvents.find((event)=>event.name==="conversion_session_locked"))&&cleanupAfterBlockers.includes(firstConversionPid))
    check("converted-reservation-cleanup-is-safe-no-op","[]",cleanupAfterError?.message??[],!cleanupAfterError&&cleanupAfterEvents.some((event)=>event.name==="cleanup_skipped_converted_reservations"))
    const afterConvertedCleanup=await saveSnapshot([batch.id])
    check("cleanup-after-conversion-preserves-all-converted-stock",true,{status:afterConvertedCleanup.reservations.find((row)=>row.id===conversionFirstRows[0].id).status,
      releaseMoves:afterConvertedCleanup.movements.filter((row)=>row.reference_id===conversionFirstRows[0].id&&row.movement_type==="reservation_release").length},
      conversionFirstResult.allocations.length===1&&afterConvertedCleanup.reservations.find((row)=>row.id===conversionFirstRows[0].id).status==="converted"&&
      !afterConvertedCleanup.movements.some((row)=>row.reference_id===conversionFirstRows[0].id&&row.movement_type==="reservation_release"))

    const stale=await makeCart([{quantity:1}],"stale-conversion-epoch")
    await new InventoryLedger(runtime.container).reserveCart(stale.authority)
    const staleRows=await reservationsFor(stale.authority.attemptId),staleOrder=await makeNativeOrder(stale)
    const beforeStale=await saveSnapshot([batch.id])
    await expectCode("stale-epoch-is-rejected-before-conversion-writes","STALE_CHECKOUT_EPOCH",()=>new InventoryLedger(runtime.container).convertCartReservationsToAllocations({...conversionInput(stale,staleOrder,staleRows.map((row)=>row.id)),epoch:2}))
    const afterStale=await saveSnapshot([batch.id])
    check("stale-epoch-case-leaves-conversion-state-unchanged",true,{allocations:afterStale.allocations.length-beforeStale.allocations.length,
      reservations:afterStale.reservations.filter((row)=>row.checkout_attempt_id===stale.authority.attemptId).map((row)=>row.status)},
      afterStale.allocations.length===beforeStale.allocations.length&&staleRows.every((row)=>afterStale.reservations.find((r)=>r.id===row.id).status==="active"))

    const expired=await makeCart([{quantity:1}],"expired-conversion-candidate")
    await new InventoryLedger(runtime.container).reserveCart(expired.authority)
    const expiredRows=await reservationsFor(expired.authority.attemptId),expiredOrder=await makeNativeOrder(expired)
    await adminPg.query("UPDATE cart_batch_reservation SET expires_at=NOW()-INTERVAL '1 second' WHERE id=ANY($1::text[])",[expiredRows.map((row)=>row.id)])
    const beforeExpired=await saveSnapshot([batch.id])
    await expectCode("expired-reservation-cannot-be-converted","RESERVATION_EXPIRED",()=>convert(expired,expiredOrder,expiredRows.map((row)=>row.id)))
    const afterExpired=await saveSnapshot([batch.id])
    check("expired-conversion-candidate-rolls-back-with-no-release-or-allocation",true,{allocations:afterExpired.allocations.length-beforeExpired.allocations.length,
      reservationStatus:afterExpired.reservations.find((row)=>row.id===expiredRows[0].id).status},
      afterExpired.allocations.length===beforeExpired.allocations.length&&afterExpired.reservations.find((row)=>row.id===expiredRows[0].id).status==="active"&&
      !afterExpired.movements.some((row)=>row.reference_id===expiredRows[0].id&&row.movement_type==="reservation_release"))

    const unresolved=await makeCart([{quantity:1}],"unknown-native-order-outcome")
    await new InventoryLedger(runtime.container).reserveCart(unresolved.authority)
    const unresolvedRows=await reservationsFor(unresolved.authority.attemptId),unresolvedOrder=await makeNativeOrder(unresolved,{bindAttempt:false})
    await adminPg.query(`UPDATE cart_checkout_attempt SET attempt_status='order_creation_started',order_correlation_status='pending_correlation'
      WHERE checkout_attempt_id=$1::uuid`,[unresolved.authority.attemptId])
    const beforeUnresolved=await saveSnapshot([batch.id])
    await expectCode("uncertain-order-correlation-fences-conversion","ORDER_NOT_AUTHORITATIVELY_BOUND",()=>convert(unresolved,unresolvedOrder,unresolvedRows.map((row)=>row.id)))
    await expectCode("uncertain-order-correlation-fences-expiry-cleanup","ORDER_CORRELATION_UNRESOLVED",()=>new InventoryLedger(runtime.container).cleanupExpired(unresolved.authority))
    const afterUnresolved=await saveSnapshot([batch.id])
    check("uncertain-order-outcome-retains-reservation-fence",true,{orderLinkExists:true,status:afterUnresolved.reservations.find((row)=>row.id===unresolvedRows[0].id).status,
      allocationDelta:afterUnresolved.allocations.length-beforeUnresolved.allocations.length,
      releaseMovement:afterUnresolved.movements.some((row)=>row.reference_id===unresolvedRows[0].id&&row.movement_type==="reservation_release")},
      afterUnresolved.reservations.find((row)=>row.id===unresolvedRows[0].id).status==="active"&&afterUnresolved.allocations.length===beforeUnresolved.allocations.length&&
      !afterUnresolved.movements.some((row)=>row.reference_id===unresolvedRows[0].id&&row.movement_type==="reservation_release"))

    const race=await makeCart([{quantity:2}],"same-order-two-converters")
    await new InventoryLedger(runtime.container).reserveCart(race.authority)
    const raceRows=await reservationsFor(race.authority.attemptId),raceOrder=await makeNativeOrder(race)
    let releaseFirst,firstAtLocks
    const firstGate=new Promise((resolve)=>{releaseFirst=resolve}),firstEntered=new Promise((resolve)=>{firstAtLocks=resolve})
    const leftEvents=[],rightEvents=[]
    const left=new InventoryLedger(runtime.container,{event:async(name,data)=>{leftEvents.push({name,...data});if(name==="conversion_reservations_locked"){firstAtLocks();await firstGate}}})
      .convertCartReservationsToAllocations(conversionInput(race,raceOrder,raceRows.map((row)=>row.id)))
    await firstEntered
    const right=new InventoryLedger(runtime.container,{event:(name,data)=>rightEvents.push({name,...data})})
      .convertCartReservationsToAllocations(conversionInput(race,raceOrder,raceRows.map((row)=>row.id)))
    await waitUntil(()=>rightEvents.some((event)=>event.name==="transaction_started"),"second conversion transaction")
    const leftPid=leftEvents.find((event)=>event.name==="transaction_started").pid,rightPid=rightEvents.find((event)=>event.name==="transaction_started").pid
    let raceBlockers=[]
    await waitUntil(async()=>{raceBlockers=(await adminPg.query("SELECT pg_blocking_pids($1::int) AS blockers",[rightPid])).rows[0].blockers;return raceBlockers.includes(leftPid)},"order-root conversion serialization")
    events.push({event:"two_conversions_same_order",leftPid,rightPid,blockingPids:raceBlockers,at:new Date().toISOString()})
    releaseFirst()
    const [leftResult,rightResult]=await Promise.all([left,right])
    const raceSnapshot=await saveSnapshot([batch.id])
    dbAfter=raceSnapshot
    check("same-order-converters-serialize-on-real-order-root",true,{leftReplay:leftResult.replay,rightReplay:rightResult.replay,blockerPids:raceBlockers},
      leftPid!==rightPid&&raceBlockers.includes(leftPid)&&leftResult.replay!==rightResult.replay)
    check("same-batch-conversion-contention-produces-one-committed-set",true,{allocationRows:raceSnapshot.allocations.filter((row)=>row.order_id===raceOrder.id).length,
      movementRows:raceSnapshot.movements.filter((row)=>row.reference_id===raceOrder.id&&row.movement_type==="allocation_conversion").length},
      raceSnapshot.allocations.filter((row)=>row.order_id===raceOrder.id).length===1&&raceSnapshot.movements.filter((row)=>row.reference_id===raceOrder.id&&row.movement_type==="allocation_conversion").length===1)
    status="passed"
  }
} catch (error) {
  blocker = error.stack || String(error)
  console.error(blocker)
  assertions.push({ name: "execution_completed", expected: true, actual: error.message, passed: false })
} finally {
  try {
    if (runtime && locking) {
      const carts = await (adminPg ? adminPg.query("SELECT cart_id FROM cart_checkout_session") : Promise.resolve({ rows: [] })).catch(() => ({ rows: [] }))
      for (const row of carts.rows) {
        try { await locking.release("cart:" + row.cart_id, { ownerId: (await adminPg.query("SELECT lease_owner_id FROM cart_checkout_attempt WHERE cart_id=$1 ORDER BY epoch DESC LIMIT 1", [row.cart_id])).rows[0]?.lease_owner_id }) }
        catch (error) { cleanupErrors.push("redis lock cleanup: " + error.message) }
      }
    }
  } catch (error) { cleanupErrors.push("redis cleanup enumeration: " + error.message) }
  if (runtime) { try { await runtime.shutdown() } catch (error) { cleanupErrors.push("Medusa runtime shutdown: " + error.message) } }
  await safeCloseClients({ pgClient: probePg, cleanupErrors })
  await safeCloseClients({ pgClient: adminPg, cleanupErrors })
  if (rootPg && resources.databaseCreated) {
    try {
      const active = await rootPg.query("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [dbName])
      if (active.rowCount) await rootPg.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [dbName])
      await rootPg.query(`DROP DATABASE ${safeIdent(dbName)}`)
      if (resources.rolesCreated.includes(probeRole)) await rootPg.query(`REVOKE ${safeIdent(probeRole)} FROM medusa_app`)
      for (const role of resources.rolesCreated.reverse()) await rootPg.query(`DROP ROLE IF EXISTS ${safeIdent(role)}`)
      cleanupResult = { databaseDropped: true, terminatedConnections: active.rowCount, rolesDropped: resources.rolesCreated }
    } catch (error) { cleanupErrors.push("isolated database cleanup: " + error.message); cleanupResult = { databaseDropped: false, error: error.message } }
  }
  await safeCloseClients({ pgClient: rootPg, cleanupErrors })
}
if (cleanupErrors.length) { status="failed"; blocker=(blocker || "") + " cleanup: " + cleanupErrors.join("; ") }
const assertionsFile = assertions.map((item)=>`${item.passed?"PASS":"FAIL"} ${item.name}: ${JSON.stringify(item.actual)}`).join("\n")+"\n"
const evidenceDir = path.join(repositoryRoot,"artifacts","tp-evidence",tpId)
await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(evidenceDir,{recursive:true}).then(()=>Promise.all([
  writeFile(path.join(evidenceDir,"inventory-assertions.log"),assertionsFile),
  writeFile(path.join(evidenceDir,"inventory-interleaving.json"),JSON.stringify(events,null,2)+"\n"),
  writeFile(path.join(evidenceDir,"inventory-cleanup.json"),JSON.stringify({resources,cleanupResult,cleanupErrors},null,2)+"\n"),
])))
console.log(`${tpId} Assertion Summary: ${assertions.filter((x)=>x.passed).length}/${assertions.length} passed.`)
await writeTpEvidence({ evidenceDir, tpId, title: tpId === "TP-08-native-integration" ? "Real Medusa native cart completion and inventory conversion" : ["TP-07b","TP-09","TP-10"].includes(tpId)?"Order-correlated batch inventory conversion":"Batch inventory ledger and reservation invariants", batch: "C", status, startedAt,
  ...metadata, blocker, exitCode: status==="passed"?0:1, assertions, dbBefore, dbAfter,
  containerDetails: { medusaRuntime: true, isolatedDatabase: dbName, runtimeUser: tpId==="TP-24c"?"medusa_app":"migration owner", disposableServices: targetDetails },
  testCommand: `node apps/backend/scripts/test-inventory-ledger.mjs ${tpId}`,
  assessmentType: tpId==="TP-24c"?"real PostgreSQL privilege and immutability-trigger enforcement; no production role changes": ["TP-08-native-integration","TP-08-recovery"].includes(tpId)?"real Medusa CartService cart, completeCartWorkflow native order and order_cart link, PostgreSQL correlation and allocation; no Store API cart creation or TP-01 execution; component evidence, not formal TP acceptance": ["TP-07b","TP-09","TP-10"].includes(tpId)?"authoritatively-correlated native Medusa order, real PostgreSQL conversion and concurrency behavior": "real Medusa modules and PostgreSQL transaction behavior; pre-order inventory scope only",
})
process.exit(status==="passed"?0:1)

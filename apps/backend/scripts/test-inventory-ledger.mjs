import { randomUUID, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import path from "node:path"
import {
  registerTsNode, repositoryRoot, backendRoot, getSystemMetadata,
  verifyDisposableTargetServices, loadMedusaRuntime, createPgClient,
  createRedisClient, safeCloseClients, writeTpEvidence,
} from "./shared/tp-harness.mjs"

const tpId = process.argv[2]
if (!["TP-06a", "TP-06b", "TP-07a", "TP-24c"].includes(tpId)) throw new Error("Unsupported inventory TP: " + tpId)
if (process.env.PHASE1_ALLOW_DISPOSABLE_DB_CREATE_DROP !== "true") throw new Error("Disposable database create/drop opt-in is required")
const rootRequire = registerTsNode()
const { Modules, ContainerRegistrationKeys } = await import("@medusajs/framework/utils")
const { InventoryLedger, movementDedupKey } = rootRequire("./apps/backend/src/modules/batch-inventory/ledger.ts")
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
  const movements = await pg.query("SELECT * FROM inventory_movement ORDER BY id")
  const attempts = await pg.query("SELECT * FROM cart_checkout_attempt ORDER BY checkout_attempt_id")
  const sessions = await pg.query("SELECT * FROM cart_checkout_session ORDER BY cart_id")
  const leases = await pg.query("SELECT key,status,lease_owner_id,last_heartbeat_at FROM idempotency_key ORDER BY key")
  return { batches: batches.rows, reservations: reservations.rows, movements: movements.rows, attempts: attempts.rows, sessions: sessions.rows, leases: leases.rows }
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
  const makeCart = async (items, label = "inventory") => {
    const cart = await cartService.createCarts({ currency_code: "egp", metadata: { disposable_fixture: tpId, label } })
    const lineItems = items.map(({ quantity, key = randomUUID() }) => ({ title: "Synthetic batch line", product_title: "Disposable product",
      variant_title: "Batch tracked test variant", variant_id: variantId, quantity, unit_price: 1000,
      requires_shipping: true, metadata: { checkout_line_key: key } }))
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
  const saveSnapshot = async (batchIds) => snapshotTables(adminPg, batchIds)

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
await writeTpEvidence({ evidenceDir, tpId, title: "Batch inventory ledger and reservation invariants", batch: "C", status, startedAt,
  ...metadata, blocker, exitCode: status==="passed"?0:1, assertions, dbBefore, dbAfter,
  containerDetails: { medusaRuntime: true, isolatedDatabase: dbName, runtimeUser: tpId==="TP-24c"?"medusa_app":"migration owner", disposableServices: targetDetails },
  testCommand: `node apps/backend/scripts/test-inventory-ledger.mjs ${tpId}`,
  assessmentType: tpId==="TP-24c"?"real PostgreSQL privilege and immutability-trigger enforcement; no production role changes": "real Medusa modules and PostgreSQL transaction behavior; pre-order inventory scope only",
})
process.exit(status==="passed"?0:1)

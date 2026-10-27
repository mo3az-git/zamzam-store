import test from "node:test"
import assert from "node:assert/strict"
import {randomUUID} from "node:crypto"
import {createRequire} from "node:module"
import {readBatchAvailability} from "../src/modules/batch-inventory/availability.ts"

// Never connect to persistent/local/production databases. Only the disposable
// GitHub Actions PostgreSQL service and explicit scoped CI opt-in are permitted.
function enforceCiBoundary() {
 const url = new URL(process.env.DATABASE_URL || "postgres://invalid/")
 const redis = new URL(process.env.REDIS_URL || "redis://invalid/")
 if (process.env.GITHUB_ACTIONS !== "true" ||
     process.env.PHASE3_INVENTORY_DISPOSABLE_TEST !== "true" ||
     url.protocol !== "postgres:" ||
     !["127.0.0.1","localhost"].includes(url.hostname) ||
     url.port !== "5432" || url.pathname !== "/zamzam_consolidation" ||
     redis.protocol !== "redis:" ||
     !["127.0.0.1","localhost"].includes(redis.hostname) ||
     redis.port !== "6379") {
  throw new Error("Refusing inventory fixture: explicit isolated GitHub Actions service required")
 }
}
const {Client} = createRequire(import.meta.url)("pg")
const readAdapter = (client) => ({
  async raw(sql, values) {
    let n = 0
    // pg's wire protocol uses $1..$N; real Medusa's Knex uses ? markers.
    const prepared = sql.replace(/\?/g, () => "$" + (++n))
    assert.equal(n, values.length, "SQL bindings must not be omitted")
    return client.query(prepared, values)
  },
})
const req=(variantId,minShelfLifeDays=30)=>({variantId,minShelfLifeDays})
test("FEFO query against real migrated PostgreSQL ledger tables (disposable)",async(t)=>{
 enforceCiBoundary()
 const db = new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000})
 await db.connect()
 try {
  await db.query("BEGIN")
  const marker=randomUUID().replaceAll("-","").slice(0,16)
  const loc="loc_qa_"+marker, otherLoc="loc_other_"+marker, inactiveLoc="loc_off_"+marker
  const supplier="supplier_qa_"+marker, inactiveSupplier="supplier_off_"+marker
  const good="var_good_"+marker, sold="var_sold_"+marker, boundary="var_edge_"+marker
  for(const [id,active] of [[supplier,true],[inactiveSupplier,false]])
   await db.query("INSERT INTO supplier (id,name,country_code,is_active) VALUES($1,'QA synthetic','eg',$2)",[id,active])
  for(const [id,active] of [[loc,true],[otherLoc,true],[inactiveLoc,false]])
   await db.query("INSERT INTO inventory_location (id,name,address_line1,governorate_code,is_active) VALUES($1,'QA synthetic','Disposable','Cairo',$2)",[id,active])
  async function batch({variant=good,location=loc,source=supplier,status="available",onhand=10,reserved=0,quarantined=0,days=90}={}){
   await db.query([
    "INSERT INTO inventory_batch",
    "(id,variant_id,location_id,supplier_id,batch_number,supplier_invoice_reference,receipt_operation_id,expiration_date,status,",
    "quantity_on_hand,quantity_reserved,quantity_quarantined,purchase_price_raw,exchange_rate_to_egp,unit_cost_purchase,unit_cost_final)",
    "VALUES($1,$2,$3,$4,'QA-LOT','QA-INVOICE',$5,",
    "(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date + ($6::int * INTERVAL '1 day'),",
    "$7,$8,$9,$10,1,1,1,1)"
   ].join(" "),[ "batch_qa_"+randomUUID(),variant,location,source,randomUUID(),days,status,onhand,reserved,quarantined ])
  }
  await batch({reserved:6,quarantined:3}) // exactly one eligible unit
  await batch({location:otherLoc,onhand:500})
  await batch({location:inactiveLoc,onhand:500})
  await batch({source:inactiveSupplier,onhand:500})
  await batch({status:"quarantined",onhand:500})
  await batch({status:"expired",onhand:500})
  await batch({days:5,onhand:500})
  await batch({days:30,onhand:500}) // strict > day cutoff
  await batch({variant:boundary,days:30,onhand:5})
  await batch({variant:sold,onhand:4,reserved:4})
  const read=readAdapter(db)
  await t.test("positive eligible remainder, fully reserved, strict shelf-life cutoff",async()=>{
   const output=await readBatchAvailability(read,[req(good),req(sold),req(boundary)],[loc])
   assert.deepEqual(output.items,[
     {variantId:good,status:"available"},
     {variantId:sold,status:"unavailable"},
     {variantId:boundary,status:"unavailable"}
   ])
  })
  await t.test("scoping never includes out-of-channel or inactive warehouses",async()=>{
   assert.deepEqual((await readBatchAvailability(read,[req(good)],[inactiveLoc])).items,[{variantId:good,status:"unavailable"}])
   assert.deepEqual((await readBatchAvailability(read,[req(sold)],[otherLoc])).items,[{variantId:sold,status:"unavailable"}])
  })
  await t.test("unknown policy or absent/invalid scoped locations fail closed",async()=>{
   let invocations=0
   const probe={raw:async()=>{invocations++;throw new Error("Stock query must not execute")}}
   for(const input of [[],null,undefined,[loc,loc]]) {
    const actual=await readBatchAvailability(probe,[req(good)],input)
    assert.deepEqual(actual.items,[{variantId:good,status:"unknown"}])
   }
   assert.equal(invocations,0)
   const actual=await readBatchAvailability(read,[req(good,null)],[loc])
   assert.deepEqual(actual.items,[{variantId:good,status:"unknown"}])
  })
  await t.test("missing variant is unavailable on healthy PostgreSQL snapshot",async()=>{
   const unknown="var_missing_"+marker
   assert.deepEqual((await readBatchAvailability(read,[req(unknown)],[loc])).items,[{variantId:unknown,status:"unavailable"}])
  })
  const audit=await db.query("SELECT count(*)::int AS n FROM inventory_movement WHERE batch_id LIKE 'batch_qa_%'")
  assert.equal(audit.rows[0].n,0,"Read-only projection cannot mutate inventory movements")
 } finally {
  try {await db.query("ROLLBACK")} finally {await db.end()}
 }
})

import test from "node:test"
import assert from "node:assert/strict"
import { readBatchAvailability } from "../src/modules/batch-inventory/availability.ts"

const req = (id, days = 30) => ({ variantId: id, minShelfLifeDays: days })
function db(rows, options = {}) {
  const calls = []
  return {
    calls,
    async raw(sql, params) {
      calls.push({ sql, params })
      if (options.fail) throw new Error("simulated inventory database outage")
      return { rows }
    },
  }
}
test("positive eligible remainder is available, zero is unavailable; no sensitive fields escape", async () => {
  const source = db([
    { variant_id: "variant_1", eligible_units: "12" },
    { variant_id: "variant_2", eligible_units: "0" },
  ])
  const output = await readBatchAvailability(source, [req("variant_1"), req("variant_2", 42)], ["loc_authorized"])
  assert.deepEqual(output, {
    authority: "batch_inventory",
    items: [
      { variantId: "variant_1", status: "available" },
      { variantId: "variant_2", status: "unavailable" },
    ],
  })
  assert.deepEqual(source.calls[0].params, ["variant_1", 30, "variant_2", 42, ["loc_authorized"]])
  assert.match(source.calls[0].sql, /quantity_on_hand - batch\.quantity_reserved/)
  assert.match(source.calls[0].sql, /batch\.quantity_quarantined/)
  assert.match(source.calls[0].sql, /batch\.status = 'available'/)
  assert.match(source.calls[0].sql, /supplier\.is_active IS TRUE/)
  assert.match(source.calls[0].sql, /location\.is_active IS TRUE/) 
  assert.match(source.calls[0].sql, /location\.id = ANY\(\?::text\[\]\)/)
  assert.match(source.calls[0].sql, /Africa\/Cairo/)
  assert.match(source.calls[0].sql, /expiration_date >/)
  assert.ok(!JSON.stringify(output).includes("quantity"))
  assert.ok(output.items.every((item) => !Object.keys(item).some((key) => /batch|quantity|supplier|expiry|cost/i.test(key))))
})
test("missing shelf-life policy always yields unknown, without a hidden 0-day assumption", async () => {
  const source = db([{variant_id:"variant_1",eligible_units:"1"}])
  const output = await readBatchAvailability(source, [req("variant_1", null),req("variant_2")], ["loc_authorized"])
  assert.deepEqual(output.items, [
    { variantId: "variant_1", status: "unknown" },
    { variantId: "variant_2", status: "unknown" },
  ])
  assert.deepEqual(source.calls[0].params, ["variant_2", 30, ["loc_authorized"]])
  assert.deepEqual((await readBatchAvailability(db([]), [req("variant_1", null)], ["loc_authorized"])).items,
    [{variantId:"variant_1",status:"unknown"}])
})
test("failed database or incomplete/corrupt rows fail closed to unknown", async () => {
  for(const source of [
    db([], {fail:true}), db([]),
    db([{variant_id:"variant_1", eligible_units:"-1"}]),
    db([{variant_id:"variant_1", eligible_units:"1.5"}]),
    db([{variant_id:"variant_1", eligible_units:"1"}, {variant_id:"variant_1",eligible_units:"5"}]),
  ]) {
    const result = await readBatchAvailability(source, [req("variant_1")], ["loc_authorized"])
    assert.deepEqual(result.items,[{variantId:"variant_1", status:"unknown"}])
  }
})
test("never accepts malformed variant IDs, missing/malformed policies or more than 100 requests", async () => {
  const source=db([])
  for (const list of [
    [], Array.from({length:101}, (_,i)=>req("variant_"+i)),
    [req("variant_1"),req("variant_1")],
    [req(" variant_1")], [req("variant_1;DROP")],
    [req("variant_1",-1)], [req("variant_1",1.5)],
    [req("variant_1",366)], [{ variantId: "variant_1" }],
  ]) await assert.rejects(readBatchAvailability(source,list, ["loc_authorized"]), /availability request/)
  assert.equal(source.calls.length,0)
})
test("no public route is created and the module remains read-only", async () => {
  const source=db([{variant_id:"variant_1",eligible_units:"1"}])
  await readBatchAvailability(source,[req("variant_1")], ["loc_authorized"])
  assert.equal(source.calls.length,1)
  assert.match(source.calls[0].sql,/^WITH requested/)
  assert.doesNotMatch(source.calls[0].sql,/\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|CREATE)\b/i)
})

test("custom location scope is mandatory, fail-closed and never read from unscoped batches", async () => {
  for (const scope of [undefined, null, [], ["loc_same","loc_same"], ["loc_bad;DROP"], [42]]) {
    const source=db([{variant_id:"variant_1",eligible_units:"123"}])
    const result=await readBatchAvailability(source,[req("variant_1")],scope)
    assert.deepEqual(result.items,[{variantId:"variant_1",status:"unknown"}])
    assert.equal(source.calls.length,0)
  }
  const source=db([{variant_id:"variant_1",eligible_units:"3"}])
  const result=await readBatchAvailability(source,[req("variant_1")],["loc_scoped_1","loc_scoped_2"])
  assert.deepEqual(result.items,[{variantId:"variant_1",status:"available"}])
  assert.deepEqual(source.calls[0].params,["variant_1",30,["loc_scoped_1","loc_scoped_2"]])
  assert.match(source.calls[0].sql,/location\.id = ANY\(\?::text\[\]\)/)
})

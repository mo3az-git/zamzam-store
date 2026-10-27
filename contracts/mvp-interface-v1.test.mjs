import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import Ajv from "ajv"

const schema = JSON.parse(readFileSync(new URL("./mvp-interface-v1.schema.json", import.meta.url), "utf8"))
const ajv = new Ajv({allErrors:true, strict:false})
ajv.addSchema(schema, "mvp")
const get = (name) => {
  const validate = ajv.getSchema("mvp#/definitions/" + name)
  assert.ok(validate, "missing schema: " + name)
  return (value) => validate(value)
}
const availability = get("availabilityResponse")
const command = get("checkoutCommand")
const result = get("checkoutResult")
const uuid = "d9ddc33a-9b44-4c84-b36d-f9d5934bc7bd"

test("only batch-authoritative availability, no stock quantities or internals",()=>{
  assert.equal(availability({authority:"batch_inventory",items:[{variantId:"variant_a",status:"unknown"}]}),true)
  assert.equal(availability({authority:"native_stock",items:[{variantId:"v",status:"available"}]}),false)
  assert.equal(availability({authority:"batch_inventory",items:[{variantId:"v",status:"available",quantity:500}]}),false)
  assert.equal(availability({authority:"batch_inventory",items:[{variantId:"v",status:"sold_out"}]}),false)
})
test("checkout intent rejects client money, stock, owner and order IDs",()=>{
  const minimal={cartId:"cart_abc",idempotencyKey:uuid,paymentMethod:"cod"}
  assert.equal(command(minimal),true)
  assert.equal(command({...minimal,paymentMethod:"electronic"}),true)
  for(const extra of [{amountMinor:"6170"},{orderId:"order_123"},{leaseOwnerId:"worker"},{batchId:"batch_secret"},{price:61.7}]){
    assert.equal(command({...minimal,...extra}),false)
  }
  assert.equal(command({...minimal,idempotencyKey:"free-form"}),false)
})
test("completed result requires canonical EGP minor units and a verified order identity",()=>{
  const complete={status:"completed",orderId:"order_abc",currency:"EGP",totalMinor:"6170",orderVersion:1}
  assert.equal(result(complete),true)
  assert.equal(result({...complete,totalMinor:6170}),false)
  assert.equal(result({...complete,totalMinor:"0"}),false)
  assert.equal(result({...complete,currency:"USD"}),false)
  assert.equal(result({...complete,orderVersion:0}),false)
  assert.equal(result({...complete,checkoutAttemptId:"internal"}),false)
})
test("pending and blocked results do not report order success, internal locks or money",()=>{
  assert.equal(result({status:"pending_reconciliation",reference:"opaque_ref",retryAfterSeconds:10}),true)
  assert.equal(result({status:"pending_reconciliation",reference:"opaque_ref",orderId:"order_abc"}),false)
  assert.equal(result({status:"blocked",reasonCode:"CART_NOT_READY"}),true)
  assert.equal(result({status:"blocked",reasonCode:"SQL_ERROR",sql:"secret"}),false)
  assert.equal(result({status:"blocked",reasonCode:"OUT_OF_STOCK",amountMinor:"100"}),false)
})

import test from "node:test"
import assert from "node:assert/strict"
import { resolveScopedVariantPolicies } from "../src/modules/batch-inventory/store-visibility.ts"

const visible = (id="variant_1", status="published", channels=["sc_public"], days=30) => ({
 id, manage_inventory:false, metadata: {packaging: {min_shelf_life_days: days}},
 product: {id:"prod_1", status, sales_channels:channels.map(id=>({id}))}
})
const query = (data, {fail=false}={}) => {
 const calls=[]
 return {calls, async graph(input) {
   calls.push(input)
   if(fail) throw new Error("simulated Medusa Query failure")
   return {data}
 }}
}
const denied=(id="variant_1")=>({variantId:id,visible:false,minShelfLifeDays:null})

test("published product and trusted publishable-key sales channel allow internal policy lookup",async()=>{
 const q=query([visible()])
 const result=await resolveScopedVariantPolicies(q,["variant_1"],["sc_public"])
 assert.deepEqual(result,[{variantId:"variant_1",visible:true,minShelfLifeDays:30}])
 assert.deepEqual(q.calls,[{entity:"variant",fields:["id","metadata","manage_inventory","product.id","product.status","product.sales_channels.id"],filters:{id:["variant_1"]}}])
})
test("different sales channel and draft/unpublished products are denied",async()=>{
 for(const rows of [[visible("variant_1","published",["sc_other"])],
   [visible("variant_1","draft",["sc_public"])],
   [visible("variant_1","published",[])],
   [{id:"variant_1",metadata: {packaging:{min_shelf_life_days:30}},product:{id:"prod_1",sales_channels:[{id:"sc_public"}]}}],
   [{id:"variant_1",product:null}],
   [{...visible(),manage_inventory:true}],
   [{...visible(),manage_inventory:null}]]) {
  assert.deepEqual(await resolveScopedVariantPolicies(query(rows),["variant_1"],["sc_public"]),[denied()])
 }
})
test("missing/invalid trusted shelf-life is unknown while visible remains true",async()=>{
 for(const days of [null," 30 ",-1,366,1.5]) {
   const result=await resolveScopedVariantPolicies(query([visible("variant_1","published",["sc_public"],days)]),["variant_1"],["sc_public"])
   assert.deepEqual(result,[{variantId:"variant_1",visible:true,minShelfLifeDays:null}])
 }
})
test("missing/duplicate/corrupted Query result and exceptions all fail closed",async()=>{
 for(const q of [
   query([]),query(null),query([{id:"variant_not_requested",product:{}}]),
   query([visible(),visible()]),query([visible()],{fail:true}),
   query([{id:"variant_1",product:{id:"prod_1",status:"published",sales_channels:"sc_public"}}])
 ]) {
  assert.deepEqual(await resolveScopedVariantPolicies(q,["variant_1"],["sc_public"]),[denied()])
 }
})
test("blank/unverified key scope never queries Medusa or exposes visibility",async()=>{
 for(const ids of [[],null,undefined,["sc_public","sc_public"],["sc;attack"],[1]]) {
  const q=query([visible()])
  assert.deepEqual(await resolveScopedVariantPolicies(q,["variant_1"],ids),[denied()])
  assert.equal(q.calls.length,0)
 }
})
test("reject malformed/duplicate/oversized client variant IDs before Query",async()=>{
 const q=query([visible()])
 for(const ids of [[],["variant_1","variant_1"],["variant_1;DROP"],[" variant_1"],Array.from({length:101},(_,i)=>"var_"+i)]) {
  await assert.rejects(resolveScopedVariantPolicies(q,ids,["sc_public"]),/Invalid requested variant IDs/)
 }
 assert.equal(q.calls.length,0)
})
test("trusted scope across multiple sales channels and missing requested variant",async()=>{
 const results=await resolveScopedVariantPolicies(
  query([visible("variant_1","published",["sc_second"],0)]),
  ["variant_1","variant_2"],["sc_first","sc_second"])
 assert.deepEqual(results,[{variantId:"variant_1",visible:true,minShelfLifeDays:0},denied("variant_2")])
})

test("ledger-compatible managed-stock flag and numeric string shelf-life policy", async()=>{
  for(const manage_inventory of [true,null,undefined,"false",1]){
    const q=query([{...visible(),manage_inventory}])
    assert.deepEqual(await resolveScopedVariantPolicies(q,["variant_1"],["sc_public"]),[denied()])
  }
  for(const raw of ["30","0","365"]){
    const q=query([visible("variant_1","published",["sc_public"],raw)])
    assert.deepEqual(await resolveScopedVariantPolicies(q,["variant_1"],["sc_public"]),[
      {variantId:"variant_1",visible:true,minShelfLifeDays:Number(raw)}
    ])
  }
  for(const raw of ["01"," 30 ","-1","1e2", "366", "10000000000000000"]){
    const q=query([visible("variant_1","published",["sc_public"],raw)])
    assert.deepEqual(await resolveScopedVariantPolicies(q,["variant_1"],["sc_public"]),[
      {variantId:"variant_1",visible:true,minShelfLifeDays:null}
    ])
  }
})

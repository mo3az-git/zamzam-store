import assert from "node:assert/strict"
import {randomUUID} from "node:crypto"
import path from "node:path"
import {
  registerTsNode, backendRoot, loadMedusaRuntime
} from "./shared/tp-harness.mjs"

// This creates disposable Medusa Product, Sales Channel and API key records,
// but NEVER creates a cart, batch allocation or order, and NEVER touches TP.
function insistDisposable() {
 const db=new URL(process.env.DATABASE_URL || "postgres://invalid/")
 const redis=new URL(process.env.REDIS_URL || "redis://invalid/")
 if(process.env.GITHUB_ACTIONS!=="true" ||
    process.env.PHASE3_MEDUSA_VISIBILITY_CI!=="true" ||
    db.protocol!=="postgres:" || db.hostname!=="127.0.0.1" ||
    db.port!=="5432" || db.pathname!=="/zamzam_consolidation" ||
    redis.protocol!=="redis:" || redis.hostname!=="127.0.0.1" ||
    redis.port!=="6379") {
   throw new Error("REFUSED: only the designated disposable GitHub Actions Medusa fixture may run")
 }
}

insistDisposable()
const rootRequire=registerTsNode()
const {ContainerRegistrationKeys,Modules}=rootRequire("@medusajs/framework/utils")
const {resolveScopedVariantPolicies}=rootRequire(
 path.join(backendRoot,"src/modules/batch-inventory/store-visibility.ts")
)
let runtime
try{
 runtime=await loadMedusaRuntime()
 const container=runtime.container
 const query=container.resolve(ContainerRegistrationKeys.QUERY)
 const links=container.resolve(ContainerRegistrationKeys.LINK)
 const products=container.resolve(Modules.PRODUCT)
 const channels=container.resolve(Modules.SALES_CHANNEL)
 const apiKeys=container.resolve(Modules.API_KEY)
 const random=()=>randomUUID().slice(0,8)
 const publicChannel=await channels.createSalesChannels({name:"Phase3 QA public "+random()})
 const privateChannel=await channels.createSalesChannels({name:"Phase3 QA private "+random()})
 const publishableKey=await apiKeys.createApiKeys({
  title:"Phase3 QA publishable "+random(),type:"publishable",created_by:"phase3-disposable-fixture"
 })
 await links.create({
  [Modules.API_KEY]:{publishable_key_id:publishableKey.id},
  [Modules.SALES_CHANNEL]:{sales_channel_id:publicChannel.id}
 })
 const product=await products.createProducts({
  title:"Phase3 QA published "+random(),status:"published",
  options:[],variants:[{
   title:"Phase3 batch-managed",manage_inventory:false,sku:"QA3-"+random(),
   metadata:{packaging:{min_shelf_life_days:30}}
  }]
 })
 const variants=await products.listProductVariants({product_id:product.id})
 const v=variants[0]
 assert.ok(v?.id,"Real Medusa must create a native variant")
 const denied={variantId:v.id,visible:false,minShelfLifeDays:null}
 let result=await resolveScopedVariantPolicies(query,[v.id],[publicChannel.id])
 assert.deepEqual(result,[denied],"An unlinked product cannot leak into publishable channel")
 await links.create({
  [Modules.PRODUCT]:{product_id:product.id},
  [Modules.SALES_CHANNEL]:{sales_channel_id:publicChannel.id}
 })
 result=await resolveScopedVariantPolicies(query,[v.id],[publicChannel.id])
 assert.deepEqual(result,[{variantId:v.id,visible:true,minShelfLifeDays:30}],
  "Published native batch-managed variant linked to scoped channel must resolve")
 assert.deepEqual(await resolveScopedVariantPolicies(query,[v.id],[privateChannel.id]),[denied],
  "Another Medusa sales channel must not see variant")
 assert.deepEqual(await resolveScopedVariantPolicies(query,[v.id],[]),[denied],
  "No publishable-key scope must never authorize read")
 const draft=await products.createProducts({
  title:"Phase3 QA draft "+random(),status:"draft",options:[],
  variants:[{title:"Draft batch-managed",manage_inventory:false,sku:"QA3-"+random(),
   metadata:{packaging:{min_shelf_life_days:30}}}]
 })
 const draftVariant=(await products.listProductVariants({product_id:draft.id}))[0]
 assert.ok(draftVariant?.id)
 await links.create({
  [Modules.PRODUCT]:{product_id:draft.id},
  [Modules.SALES_CHANNEL]:{sales_channel_id:publicChannel.id}
 })
 assert.deepEqual(await resolveScopedVariantPolicies(query,[draftVariant.id],[publicChannel.id]),[
  {variantId:draftVariant.id,visible:false,minShelfLifeDays:null}
 ],"Draft products must never show batch availability")
 const actual=await query.graph({entity:"sales_channel",
  fields:["id","publishable_api_keys.id"],filters:{id:[publicChannel.id]}})
 assert.ok(actual?.data?.[0]?.publishable_api_keys?.some(x=>x.id===publishableKey.id),
  "Publishable API key must be linked to allowed sales channel in real Medusa graph")
 console.log("PHASE3 MEDUSA QUERY PASS: publishable key/channel link, published variant, denied draft, wrong channel, empty context")
 console.log("No cart, order, payment, batch allocation or TP suite executed")
}catch(error){
 console.error("PHASE3 MEDUSA QUERY FAIL:",error?.stack||error)
 process.exitCode=1
}finally{
 if(runtime)await runtime.shutdown()
}

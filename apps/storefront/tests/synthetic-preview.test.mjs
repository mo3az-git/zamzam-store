import test from "node:test"
import assert from "node:assert/strict"
import {syntheticProducts,syntheticCategories} from "../lib/synthetic-preview.ts"
import {listStoreProducts,listStoreCategories} from "../lib/medusa.ts"
import {isCartEnabled} from "../lib/cart.ts"

test("Vercel read-only preview requires both explicit opt-in and preview environment",async()=>{
 const before={ve:process.env.VERCEL_ENV,qa:process.env.ZAMZAM_SYNTHETIC_PREVIEW,cart:process.env.FEATURE_ENABLE_MEDUSA_CART}
 try {
  delete process.env.MEDUSA_BACKEND_URL
  delete process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  process.env.ZAMZAM_SYNTHETIC_PREVIEW="true"
  process.env.VERCEL_ENV="production"
  assert.equal((await listStoreProducts()).error,"configuration")
  assert.equal((await listStoreCategories()).error,"configuration")
  process.env.VERCEL_ENV="preview"
  const products=await listStoreProducts({limit:12})
  assert.equal(products.error,null)
  assert.equal(products.count,14)
  assert.equal(products.products.length,12)
  const featured=(await listStoreProducts({handle:"qa-fixture-1"})).products[0]
  assert.equal(featured.variants.length,2)
  assert.equal(featured.variants[1].calculated_price.currency_code,"egp")
  const cat=(await listStoreCategories({handle:"fixtures"})).categories
  assert.equal(cat.length,1)
  assert.equal((await listStoreProducts({categoryId:cat[0].id})).count,7)
  assert.equal((await listStoreProducts({q:"fixture 14"})).count,1)
  assert.equal((await listStoreProducts({offset:12,limit:12})).products.length,2)
  process.env.FEATURE_ENABLE_MEDUSA_CART="true"
  assert.equal(isCartEnabled(),false,"Never expose cart mutations on synthetic preview")
 }finally{
  for(const [key,val] of [["VERCEL_ENV",before.ve],["ZAMZAM_SYNTHETIC_PREVIEW",before.qa],["FEATURE_ENABLE_MEDUSA_CART",before.cart]]) {
   if(val===undefined)delete process.env[key]
   else process.env[key]=val
  }
 }
})
test("fixture prices and placeholders make no supplier, stock, or purchase claims",()=>{
 const items=syntheticProducts({limit:20}).products
 assert.ok(items.every(x=>x.title.includes("QA")))
 assert.ok(items.every(x=>x.variants.every(v=>v.calculated_price.currency_code==="egp")))
 assert.equal(items.filter(x=>x.thumbnail===null).length,13)
 assert.equal(syntheticCategories().count,2)
})

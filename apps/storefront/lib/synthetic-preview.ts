/**
 * Synthetic, non-commercial storefront fixtures for Vercel preview QA ONLY.
 * Hard gated in lib/medusa.ts by VERCEL_ENV=preview + explicit opt-in.
 * Never sourced from suppliers and never inventory, provenance, or cart authority.
 */
import type {
  ProductQueryOptions, CategoryQueryOptions, StoreListResult,
  StoreCategoryResult, StoreProduct, StoreCategory
} from "./medusa.ts"

const categories: StoreCategory[] = [
  {id:"cat_qa_a",name:"QA Fixtures",handle:"fixtures",description:"Synthetic products for test navigation",parent_category_id:null},
  {id:"cat_qa_b",name:"QA Samples",handle:"samples",description:"Test-only catalog; not for sale",parent_category_id:null},
]
const products: Array<StoreProduct & {categoryId:string}> =
  Array.from({length:14},(_,i)=>{
    const n=i+1, featured=i===0
    return {
      id:"prod_qa_"+n,
      handle:"qa-fixture-"+n,
      title:"QA Catalog Fixture "+n,
      subtitle:"SYNTHETIC TEST PRODUCT",
      description:"Synthetic QA catalog item. No food origin, stock, shipment, or purchasing claim.",
      categoryId:i%2===0?"cat_qa_a":"cat_qa_b",
      thumbnail:featured?"/qa/fixture-one.svg":null,
      images:featured?[
        {id:"img_qa_a",url:"/qa/fixture-one.svg"},
        {id:"img_qa_b",url:"/qa/fixture-two.svg"},
      ]:[],
      variants:featured?[
        {id:"v1",title:"QA Small",sku:"QA-TEST-S",calculated_price:{calculated_amount:23.5,currency_code:"egp"}},
        {id:"v2",title:"QA Large",sku:"QA-TEST-L",calculated_price:{calculated_amount:45.75,currency_code:"egp"}},
      ]:[{id:"v1_"+n,title:"QA default",sku:"QA-TEST-"+n,calculated_price:{calculated_amount:23.5,currency_code:"egp"}}],
    }
  })

const clamp=(n:unknown,d:number,max:number)=>typeof n==="number"&&Number.isSafeInteger(n)?Math.max(0,Math.min(max,n)):d

export function syntheticProducts(options:ProductQueryOptions={}):StoreListResult {
  const q=(options.q??"").trim().toLowerCase()
  const filtered=products.filter(p=>
    (!q||p.title.toLowerCase().includes(q)) &&
    (!options.handle||p.handle===options.handle) &&
    (!options.categoryId||p.categoryId===options.categoryId))
  const limit=clamp(options.limit,12,100)||12,offset=clamp(options.offset,0,100000)
  const selected=filtered.slice(offset,offset+limit).map(({categoryId,...p})=>p)
  return {products:selected,count:filtered.length,error:null}
}

export function syntheticCategories(options:CategoryQueryOptions={}):StoreCategoryResult {
  const filtered=categories.filter(c=>
    (!options.handle||c.handle===options.handle) &&
    (!options.parentCategoryId||c.parent_category_id===options.parentCategoryId))
  const limit=clamp(options.limit,50,100)||50,offset=clamp(options.offset,0,100000)
  return {categories:filtered.slice(offset,offset+limit),count:filtered.length,error:null}
}

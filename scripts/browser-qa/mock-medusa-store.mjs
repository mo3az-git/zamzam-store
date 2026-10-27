import {createServer} from "node:http"
// Isolated read-only QA fixture. No real products, provenance or commerce.
const origin="http://127.0.0.1:9091"
const observations=[]
const imgs=["one","two"].map(name=>({id:"img_"+name,url:origin+"/images/"+name+".svg"}))
const prices=[{id:"v1",title:"Small QA sample",sku:"QA-S",calculated_price:{calculated_amount:23.5,currency_code:"egp"}},{id:"v2",title:"Large QA sample",sku:"QA-L",calculated_price:{calculated_amount:45.75,currency_code:"egp"}}]
const products=Array.from({length:14},(_,i)=>({id:"qa_"+i,handle:"qa-fixture-"+(i+1),title:"QA Catalog Fixture "+(i+1),description:"Synthetic fixture only",qaCategory:i%2?"cat_other":"cat_fixtures",thumbnail:i===0?imgs[0].url:null,images:i===0?imgs:[],variants:i===0?prices:[prices[0]]}))
const categories=[{id:"cat_fixtures",name:"QA Fixtures",handle:"fixtures",parent_category_id:null},{id:"cat_other",name:"QA Samples",handle:"samples",parent_category_id:null}]
function send(res,code,body,type="application/json"){res.writeHead(code,{"content-type":type,"cache-control":"no-store"});res.end(type==="application/json"?JSON.stringify(body):body)}
createServer((req,res)=>{
 const u=new URL(req.url||"/",origin)
 if(req.method!=="GET")return send(res,405,{error:"read-only fixture"})
 if(u.pathname.startsWith("/images/"))return send(res,200,'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#236f65"/></svg>',"image/svg+xml")
 if(u.pathname==="/__observed")return send(res,200,{requests:observations})
 if(req.headers["x-publishable-api-key"]!=="pk_qa_read_only")return send(res,401,{error:"fixture key"})
 observations.push({path:u.pathname,params:Object.fromEntries(u.searchParams)})
 if(u.pathname==="/store/regions")return send(res,200,{regions:[{id:"reg_qa_egp",currency_code:"egp"}],count:1})
 if(u.pathname==="/store/product-categories")return send(res,200,{product_categories:categories,count:categories.length})
 if(u.pathname==="/store/products"){
   const p=u.searchParams
   let selected=products.filter(x=>(!p.get("category_id")||x.qaCategory===p.get("category_id"))&&(!p.get("handle")||x.handle===p.get("handle"))&&(!p.get("q")||x.title.toLowerCase().includes(p.get("q").toLowerCase())))
   const count=selected.length, offset=Number(p.get("offset")||0), limit=Number(p.get("limit")||12)
   selected=selected.slice(offset,offset+limit).map(({qaCategory,...x})=>({...x,variants:x.variants.map(({calculated_price,...v})=>p.get("region_id")==="reg_qa_egp"?{...v,calculated_price}:v)}))
   return send(res,200,{products:selected,count})
 }
 return send(res,404,{error:"missing fixture route"})
}).listen(9091,"127.0.0.1",()=>console.log("Fixture ready on "+origin))

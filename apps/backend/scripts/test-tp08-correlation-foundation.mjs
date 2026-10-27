import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import path from "node:path"
import {
  repositoryRoot, registerTsNode, getSystemMetadata, verifyDisposableTargetServices,
  loadMedusaRuntime, createPgClient, createRedisClient, safeCloseClients, writeTpEvidence
} from "./shared/tp-harness.mjs"

const require = registerTsNode()
const { markOrderCreationStarted, reconcileOrderCreation, runOrderCreationWithFence, CorrelationConflict } =
  require(path.join(repositoryRoot, "apps/backend/src/modules/batch-inventory/order-correlation.ts"))
const { findNativeOrdersByCart } = require(path.join(repositoryRoot,
  "apps/backend/src/modules/batch-inventory/native-order-lookup.ts"))
const start = new Date().toISOString(), meta = await getSystemMetadata()
let pg, redis, runtime, db, status = "failed", blocker = null
const assertions=[], cleanupErrors=[], logLines=[], errLines=[]
const uid = () => randomUUID()
const entries=[]
const check = (name, condition, actual) => {
  const entry = {name, expected:true, actual, passed:Boolean(condition)}
  assertions.push(entry)
  const line = `${condition ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`
  console.log(line);logLines.push(line)
  if(!condition) throw new Error(name)
}
const assertConflict = async (name,job,code) => {
  let caught
  try{await job()}catch(error){caught=error}
  check(name, caught instanceof CorrelationConflict && caught.code === code, caught?.code ?? "NOT_REJECTED")
}
const state = async (id) => (await pg.query(
  "SELECT attempt_status,order_correlation_status,order_id FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid",[id]
)).rows[0]
const register = async (method="cod") => {
  const id=uid(),cartId="cart_tp08_"+uid().replace(/-/g,""),ownerId="owner_"+uid().replace(/-/g,"")
  await pg.query("INSERT INTO cart_checkout_session(cart_id,current_attempt_id,epoch,status) VALUES ($1,$2,1,'in_progress')",[cartId,id])
  await pg.query(`INSERT INTO cart_checkout_attempt(checkout_attempt_id,cart_id,epoch,idempotency_key,payment_method,lease_owner_id,attempt_status,order_correlation_status)
    VALUES ($1::uuid,$2,1,$3,$4,$5,'reserved','none')`,[id,cartId,"tp08_"+id,method,ownerId])
  const authority={cartId,attemptId:id,epoch:1,ownerId}
  entries.push(authority)
  return authority
}
const candidate = (a,id="order_tp08_"+uid().replace(/-/g,"")) => ({id,cart_id:a.cartId})
let dbBefore, dbAfter
try {
  const safety=verifyDisposableTargetServices(process.env.DATABASE_URL,process.env.LOCKING_REDIS_URL||process.env.REDIS_URL)
  check("explicit_disposable_environment",safety.verified,safety.executionProfile)
  pg=createPgClient(process.env.DATABASE_URL);await pg.connect()
  redis=createRedisClient(process.env.LOCKING_REDIS_URL||process.env.REDIS_URL);await redis.connect()
  check("real_disposable_redis_ready",(await redis.ping())==="PONG",redis.status)
  runtime=await loadMedusaRuntime()
  const {ContainerRegistrationKeys}=require("@medusajs/framework/utils")
  db=runtime.container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  check("real_medusa_postgres_connection",typeof db.transaction==="function",typeof db.transaction)
  const nativeEmpty=await findNativeOrdersByCart(db,"cart_tp08_absent_"+uid().replace(/-/g,""))
  check("native_order_cart_link_empty_lookup",Array.isArray(nativeEmpty) && nativeEmpty.length===0,nativeEmpty)
  const a=await register()
  dbBefore=await state(a.attemptId)
  check("initial_reserved_no_correlation",dbBefore.attempt_status==="reserved"&&dbBefore.order_id===null,dbBefore)
  await markOrderCreationStarted(db,a)
  let s=await state(a.attemptId)
  check("durable_pre_workflow_marker",s.attempt_status==="order_creation_started"&&s.order_correlation_status==="pending_correlation"&&s.order_id===null,s)
  let result=await reconcileOrderCreation(db,a,async()=>[])
  s=await state(a.attemptId)
  check("zero_candidates_preserve_fence",result.status==="needs_reconciliation"&&s.attempt_status==="needs_reconciliation"&&s.order_id===null,{result,s})
  await assertConflict("different_epoch_cannot_bind",()=>reconcileOrderCreation(db,{...a,epoch:2},async()=>[candidate(a)]),"STALE_OR_UNAUTHORIZED_ATTEMPT")
  const single=candidate(a)
  result=await reconcileOrderCreation(db,a,async()=>[single])
  s=await state(a.attemptId)
  check("exactly_one_binds_by_cas",result.orderId===single.id&&s.order_id===single.id&&s.order_correlation_status==="correlated",{result,s})
  result=await reconcileOrderCreation(db,a,async()=>[single])
  check("exact_reconciliation_replay",result.replay===true&&result.orderId===single.id,result)
  await assertConflict("different_bound_order_rejected",()=>reconcileOrderCreation(db,a,async()=>[candidate(a)]),"BOUND_ORDER_LOOKUP_DIVERGENCE")
  const b=await register()
  await markOrderCreationStarted(db,b)
  result=await reconcileOrderCreation(db,b,async()=>[candidate(b),candidate(b)])
  s=await state(b.attemptId)
  check("multiple_distinct_orders_fenced",result.status==="ambiguous"&&s.order_id===null&&s.attempt_status==="needs_reconciliation",{result,s})
  const c=await register()
  let workflowCalls=0
  const one=candidate(c)
  result=await runOrderCreationWithFence(db,c,async(cartId)=>{
    workflowCalls++;if(cartId!==c.cartId)throw new Error("invalid native cart")
    throw new Error("simulated native workflow timeout")
  },async()=>[one])
  check("uncertain_workflow_outcome_reconciled_to_one_order",workflowCalls===1&&result.orderId===one.id,{workflowCalls,result})
  const d=await register()
  let noResultCalls=0
  result=await runOrderCreationWithFence(db,d,async()=>{noResultCalls++;return null},async()=>[])
  const replay=await runOrderCreationWithFence(db,d,async()=>{noResultCalls++;throw new Error("must not be called")},async()=>[])
  check("started_request_not_reinvoked",noResultCalls===1&&result.status==="needs_reconciliation"&&replay.status==="needs_reconciliation",{noResultCalls,replay})
  const e=await register()
  await assertConflict("invalid_native_order_cart_rejected",()=>reconcileOrderCreation(db,e,async()=>[{id:"order_fake",cart_id:"wrong"}]),"INVALID_NATIVE_ORDER_CANDIDATE")
  s=await state(e.attemptId)
  check("bad_candidate_does_not_change_state",s.attempt_status==="reserved"&&s.order_id===null,s)
  dbAfter={a:await state(a.attemptId),b:await state(b.attemptId),c:await state(c.attemptId),d:await state(d.attemptId),e:await state(e.attemptId)}
  status="passed"
}catch(error){blocker=error.stack||String(error);errLines.push(blocker);console.error(blocker);assertions.push({name:"execution_completed",expected:true,actual:error.message,passed:false})}finally{
  if(pg){
    try{
      await pg.query("BEGIN")
      for(const x of entries){
        await pg.query("DELETE FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid",[x.attemptId])
        await pg.query("DELETE FROM cart_checkout_session WHERE cart_id=$1",[x.cartId])
      }
      await pg.query("COMMIT")
      const verify=await pg.query("SELECT count(*)::int AS n FROM cart_checkout_attempt WHERE checkout_attempt_id=ANY($1::uuid[])",[entries.map(x=>x.attemptId)])
      check("only_test_fixtures_cleaned",verify.rows[0].n===0,verify.rows[0].n)
    }catch(e){try{await pg.query("ROLLBACK")}catch{}cleanupErrors.push("fixture-cleanup:"+e.message)}
  }
  if(runtime)try{await runtime.shutdown()}catch(e){cleanupErrors.push("shutdown:"+e.message)}
  await safeCloseClients({pgClient:pg,redisClient:redis,cleanupErrors})
}
if(cleanupErrors.length){status="failed";blocker=(blocker||"")+" cleanup: "+cleanupErrors.join(";")}
console.log("TP-08 correlation foundation assertions: "+assertions.filter(x=>x.passed).length+"/"+assertions.length)
await writeTpEvidence({evidenceDir:path.join(repositoryRoot,"artifacts/tp-evidence/TP-08-foundation"),tpId:"TP-08-foundation",title:"Order start durable fence and correlation prototype",batch:"B",status,startedAt:start,...meta,blocker,exitCode:status==="passed"?0:1,
  assertions,dbBefore,dbAfter,logLines,errLines,
  assessmentType:"Real PostgreSQL and Medusa container, synthetic native workflow/order-lookup adapters; NOT TP-08a or TP-08b native acceptance",
  note:"Fenced correlation boundary test only. Synthetic order candidates do not establish Medusa completeCartWorkflow or real order cart_id association.",
  testCommand:"node apps/backend/scripts/test-tp08-correlation-foundation.mjs"})
process.exit(status==="passed"?0:1)

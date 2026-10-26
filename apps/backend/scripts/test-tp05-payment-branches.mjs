import { randomUUID, createHash } from "node:crypto"
import path from "node:path"
import { initializePaymentBranch } from "../src/modules/order-operations/payment-branch.mjs"
import {
  repositoryRoot, getSystemMetadata, verifyDisposableTargetServices,
  createPgClient, createRedisClient, safeCloseClients, writeTpEvidence,
  registerTsNode, loadMedusaRuntime,
} from "./shared/tp-harness.mjs"

registerTsNode()
const startedAt = new Date().toISOString()
const metadata = await getSystemMetadata()
const assertions = [], cleanupErrors = [], logs = [], errLines = []
let status = "failed", blocker = null, pg, redis, runtime
const runId = randomUUID().replace(/-/g, "")
const codOrder = "tp05_cod_" + runId
const electronicOrder = "tp05_ep_" + runId
const conflictOrder = "tp05_conflict_" + runId
const claimCodeHash = createHash("sha256").update("synthetic-claim-" + runId).digest("hex")
const amount = "127.50"
const base = {cartId:"tp05_cart_" + runId,checkoutAttemptId:"tp05_attempt_" + runId,
  amount,claimCodeHash,idempotencyKey:"tp05_idemp_" + runId}

function check(name, expected, actual, condition) {
  assertions.push({name,expected,actual,passed:Boolean(condition)})
  const line=`${condition ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`
  logs.push(line)
  console.log(line)
  if (!condition) throw new Error("Assertion failed: " + name)
}
async function snapshot(orderIds) {
  const operational=await pg.query("SELECT order_id,payment_method,operational_status FROM order_operational_state WHERE order_id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY order_id",[orderIds])
  const cod=await pg.query("SELECT order_id,expected_amount,collected_amount,collection_status FROM cod_collection_record WHERE order_id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY order_id",[orderIds])
  const electronic=await pg.query("SELECT order_id,cart_id,checkout_attempt_id,provider_key,amount,status,idempotency_key FROM electronic_payment_attempt WHERE order_id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY order_id",[orderIds])
  return {operational:operational.rows,cod:cod.rows,electronic:electronic.rows}
}
let dbBefore, dbAfter, containerDetails
const orderIds=[codOrder,electronicOrder,conflictOrder]
try {
  const safe=verifyDisposableTargetServices(process.env.DATABASE_URL,process.env.LOCKING_REDIS_URL||process.env.REDIS_URL)
  check("disposable_service_opt_in",true,safe.verified,safe.verified)
  pg=createPgClient(process.env.DATABASE_URL);await pg.connect()
  redis=createRedisClient(process.env.LOCKING_REDIS_URL||process.env.REDIS_URL);await redis.connect()
  check("real_redis_ping","PONG",await redis.ping(),redis.status==="ready")
  runtime=await loadMedusaRuntime()
  const module=runtime.container.resolve("order_operations")
  containerDetails={moduleResolved:Boolean(module),medusaConfigFile:"apps/backend/medusa-config.ts"}
  check("medusa_order_operations_module_resolved",true,Boolean(module),Boolean(module))
  dbBefore=await snapshot(orderIds)
  check("fixture_has_no_prior_payment_rows",0,
    dbBefore.operational.length+dbBefore.cod.length+dbBefore.electronic.length,
    dbBefore.operational.length+dbBefore.cod.length+dbBefore.electronic.length===0)

  const cod=await initializePaymentBranch(pg,{...base,method:"cod",orderId:codOrder})
  check("cod_explicit_branch", "cod",cod.method,cod.method==="cod")
  const codSnap=await snapshot(orderIds)
  check("cod_creates_exact_operational_record","cod",codSnap.operational.find(x=>x.order_id===codOrder)?.payment_method,
    codSnap.operational.find(x=>x.order_id===codOrder)?.payment_method==="cod")
  check("cod_record_persisted_with_exact_amount",amount,codSnap.cod[0]?.expected_amount,
    codSnap.cod.length===1&&codSnap.cod[0].expected_amount===amount&&codSnap.cod[0].collection_status==="unpaid")
  check("cod_does_not_create_electronic_attempt",0,codSnap.electronic.length,codSnap.electronic.length===0)
  await initializePaymentBranch(pg,{...base,method:"cod",orderId:codOrder})
  const codReplay=await snapshot(orderIds)
  check("cod_exact_replay_zero_additional_rows",codSnap,codReplay,JSON.stringify(codSnap)===JSON.stringify(codReplay))
  let wrongMethodRejected=false
  try{await initializePaymentBranch(pg,{...base,method:"electronic",orderId:codOrder})}catch(e){wrongMethodRejected=e.message==="PAYMENT_METHOD_IMMUTABLE"}
  check("cod_to_electronic_flip_rejected",true,wrongMethodRejected,wrongMethodRejected)

  const ep=await initializePaymentBranch(pg,{...base,method:"electronic",orderId:electronicOrder,
    checkoutAttemptId:"tp05_ep_attempt_"+runId,idempotencyKey:"tp05_ep_idemp_"+runId})
  check("electronic_explicit_branch","electronic",ep.method,ep.method==="electronic")
  const epSnap=await snapshot(orderIds)
  check("electronic_record_persisted","phase1-simulator",epSnap.electronic[0]?.provider_key,
    epSnap.electronic.length===1&&epSnap.electronic[0].provider_key==="phase1-simulator"&&epSnap.electronic[0].status==="initiated"&&epSnap.electronic[0].amount===amount)
  check("electronic_does_not_create_cod_record_for_order",0,epSnap.cod.filter(x=>x.order_id===electronicOrder).length,
    epSnap.cod.filter(x=>x.order_id===electronicOrder).length===0)
  await initializePaymentBranch(pg,{...base,method:"electronic",orderId:electronicOrder,
    checkoutAttemptId:"tp05_ep_attempt_"+runId,idempotencyKey:"tp05_ep_idemp_"+runId})
  const replaySnap=await snapshot(orderIds)
  check("electronic_exact_replay_zero_additional_rows",epSnap,replaySnap,JSON.stringify(epSnap)===JSON.stringify(replaySnap))

  let mismatchRejected=false
  try{await initializePaymentBranch(pg,{...base,method:"electronic",orderId:electronicOrder,amount:"127.51",
    checkoutAttemptId:"tp05_ep_attempt_"+runId,idempotencyKey:"tp05_ep_idemp_"+runId})}catch(e){mismatchRejected=e.message==="PAYMENT_INTENT_CONFLICT"}
  check("electronic_changed_amount_rejected",true,mismatchRejected,mismatchRejected)

  let invalidRejected=false
  try{await initializePaymentBranch(pg,{...base,method:"auto",orderId:conflictOrder})}catch(e){invalidRejected=e.message==="INVALID_PAYMENT_METHOD"}
  check("no_inferred_or_unknown_payment_branch",true,invalidRejected,invalidRejected)
  let malformedRejected=false
  try{await initializePaymentBranch(pg,{...base,method:"cod",orderId:conflictOrder,amount:"127.5"})}catch(e){malformedRejected=e.message==="INVALID_AMOUNT_MAJOR_UNITS"}
  check("reject_noncanonical_major_unit_amount",true,malformedRejected,malformedRejected)

  dbAfter=await snapshot(orderIds)
  check("only_two_operational_records",2,dbAfter.operational.length,dbAfter.operational.length===2)
  check("exactly_one_record_per_selected_payment_branch",{cod:1,electronic:1},
    {cod:dbAfter.cod.length,electronic:dbAfter.electronic.length},dbAfter.cod.length===1&&dbAfter.electronic.length===1)
  status="passed"
} catch(error){
  blocker=error.stack||String(error);errLines.push(blocker);console.error(blocker)
  assertions.push({name:"execution_completed",expected:true,actual:error.message,passed:false})
} finally {
  if(pg){
    try {
      // Only remove uniquely named rows created by this test; never mutate other orders.
      await pg.query("BEGIN")
      await pg.query("DELETE FROM electronic_payment_attempt WHERE order_id=ANY($1::text[])",[orderIds])
      await pg.query("DELETE FROM cod_collection_record WHERE order_id=ANY($1::text[])",[orderIds])
      await pg.query("DELETE FROM order_operational_state WHERE order_id=ANY($1::text[])",[orderIds])
      await pg.query("COMMIT")
      const cleared=await snapshot(orderIds)
      check("cleanup_removed_only_owned_fixtures",0,cleared.operational.length+cleared.cod.length+cleared.electronic.length,
        cleared.operational.length+cleared.cod.length+cleared.electronic.length===0)
    } catch(e){
      try{await pg.query("ROLLBACK")}catch{}
      cleanupErrors.push("synthetic fixtures: "+e.message)
    }
  }
  if(runtime){try{await runtime.shutdown()}catch(e){cleanupErrors.push("medusa shutdown: "+e.message)}}
  await safeCloseClients({pgClient:pg,redisClient:redis,cleanupErrors})
}
if(cleanupErrors.length){status="failed";blocker=(blocker||"")+"; cleanup: "+cleanupErrors.join("; ")}
console.log("TP-05 Assertion Summary: "+assertions.filter(x=>x.passed).length+"/"+assertions.length+" passed")
await writeTpEvidence({
  evidenceDir:path.join(repositoryRoot,"artifacts/tp-evidence/TP-05"),
  tpId:"TP-05",title:"Provider-neutral payment-method branch prototype",batch:"B",
  status,startedAt,...metadata,blocker,exitCode:status==="passed"?0:1,assertions,dbBefore,dbAfter,
  containerDetails,testCommand:"node apps/backend/scripts/test-tp05-payment-branches.mjs",
  logLines:logs,errLines,
  assessmentType:"Real disposable PostgreSQL and Medusa module prototype, synthetic order references; no native checkout/order creation or provider compatibility evidence",
  note:"TP-05 simulated branch only. Synthetic order IDs are not Medusa native orders and cannot satisfy complete checkout acceptance."
})
process.exit(status==="passed"?0:1)

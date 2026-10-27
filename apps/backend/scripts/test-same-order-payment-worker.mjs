import { registerTsNode, loadMedusaRuntime, createPgClient, verifyDisposableTargetServices } from "./shared/tp-harness.mjs"
import { finalizeCompletedCheckoutPayment } from "../src/modules/order-operations/completed-checkout-payment.mjs"

if (!process.send) throw new Error("Disposable payment worker requires IPC")
process.once("message", async ({ authority }) => {
  let runtime, db
  try {
    verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
    const require = registerTsNode()
    const { readNativePayableOrderSnapshotInTransaction, normalizeEgpTotal } =
      require("./apps/backend/src/modules/batch-inventory/native-payable-order-snapshot.ts")
    runtime = await loadMedusaRuntime()
    db = createPgClient(process.env.DATABASE_URL); await db.connect()
    const dbPid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    process.send({ type: "ready", pid: process.pid, dbPid })
    await new Promise((resolve) => process.once("message", resolve))
    const result = await finalizeCompletedCheckoutPayment(db, runtime.container, authority, {
      snapshotInTransaction: readNativePayableOrderSnapshotInTransaction, normalizeEgpTotal,
    })
    process.send({ type: "result", pid: process.pid, dbPid, result })
  } catch (error) {
    process.send({ type: "error", pid: process.pid, message: error.stack || String(error) })
  } finally {
    if (db) await db.end()
    if (runtime) await runtime.shutdown()
    process.disconnect()
  }
})

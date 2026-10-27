import { registerTsNode, loadMedusaRuntime, verifyDisposableTargetServices } from "./shared/tp-harness.mjs"

if (!process.send) throw new Error("Recovery worker must be started by the disposable test harness")
process.once("message", async (message) => {
  let runtime
  try {
    verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
    const require = registerTsNode()
    const { ContainerRegistrationKeys } = await import("@medusajs/framework/utils")
    const { completeReservedCartWithInventory } = require("./apps/backend/src/modules/batch-inventory/native-checkout-coordinator.ts")
    runtime = await loadMedusaRuntime()
    const db = runtime.container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const pid = (await db.raw("SELECT pg_backend_pid() AS pid")).rows[0].pid
    const result = await completeReservedCartWithInventory(runtime.container, message.authority)
    process.send({ result, pid, workerPid: process.pid })
  } catch (error) {
    process.send({ error: error.stack || String(error) })
  } finally {
    if (runtime) await runtime.shutdown()
    process.disconnect()
  }
})

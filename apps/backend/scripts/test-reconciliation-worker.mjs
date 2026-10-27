import { registerTsNode, loadMedusaRuntime, verifyDisposableTargetServices } from "./shared/tp-harness.mjs"

if (!process.send) throw new Error("Disposable reconciliation worker requires IPC")
process.once("message", async ({ mode, authority, boundary }) => {
  let runtime
  try {
    verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
    const require = registerTsNode()
    const { ContainerRegistrationKeys } = await import("@medusajs/framework/utils")
    const { completeReservedCartWithInventory } = require("./apps/backend/src/modules/batch-inventory/native-checkout-coordinator.ts")
    const { CheckoutReconciliationOperations } = require("./apps/backend/src/modules/batch-inventory/checkout-reconciliation-operations.ts")
    runtime = await loadMedusaRuntime()
    const db = runtime.container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const dbPid = (await db.raw("SELECT pg_backend_pid() AS pid")).rows[0].pid
    process.send({ type: "ready", pid: process.pid, dbPid })
    await new Promise((resolve) => process.once("message", resolve))
    if (mode === "crash") {
      await completeReservedCartWithInventory(runtime.container, authority, {
        [boundary]: async () => {
          await new Promise((resolve, reject) => process.send({ type: "barrier", pid: process.pid, boundary }, (error) => error ? reject(error) : resolve()))
          await new Promise(() => {})
        },
      })
      throw new Error("Expected crash barrier was not reached")
    }
    const service = new CheckoutReconciliationOperations(runtime.container, async () => true)
    const result = await service.recover(authority)
    process.send({ type: "result", result, pid: process.pid, dbPid })
  } catch (error) {
    process.send({ type: "error", message: error.stack || String(error), pid: process.pid })
  } finally {
    if (runtime) await runtime.shutdown()
    process.disconnect()
  }
})

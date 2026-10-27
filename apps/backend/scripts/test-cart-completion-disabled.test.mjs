import test from "node:test"
import assert from "node:assert/strict"
import { MedusaError } from "@medusajs/framework/utils"
import { POST } from "../src/api/store/carts/[id]/complete/route.ts"

test("cart completion is denied without resolving or invoking commerce services", async () => {
  let resolvedService = false
  const req = {
    params: { id: "cart_disposable_only" },
    scope: {
      resolve() {
        resolvedService = true
        throw new Error("commerce service must not be reached")
      },
    },
  }

  await assert.rejects(
    POST(req, {}),
    (error) => error instanceof MedusaError &&
      error.type === MedusaError.Types.NOT_FOUND &&
      error.message === "Not found"
  )
  assert.equal(resolvedService, false)
})

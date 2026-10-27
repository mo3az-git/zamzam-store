import { createRegionsWorkflow, createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function runPayableCheckoutScenarios(ctx) {
  const { runtime, knex, batch, makeCart, check, events, InventoryLedger,
    completeReservedCartWithInventory, findNativeOrdersByCart, saveSnapshot } = ctx
  const container = runtime.container
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // Disposable region and the built-in local system provider: it contacts no gateway.
  const regions = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Disposable Egypt", currency_code: "egp", countries: ["eg"],
    payment_providers: ["pp_system_default"],
  }] } })
  const regionId = regions.result[0].id
  const fixture = await makeCart([{ quantity: 2 }, { quantity: 3 }], "payable-digital-fixture", "12.34", regionId)
  await new InventoryLedger(container).reserveCart(fixture.authority)
  const paymentCollection = await createPaymentCollectionForCartWorkflow(container).run({
    input: { cart_id: fixture.cart.id },
  })
  const session = await createPaymentSessionsWorkflow(container).run({ input: {
    payment_collection_id: paymentCollection.result.id, provider_id: "pp_system_default", data: {},
  } })
  const cartGraph = await query.graph({ entity: "cart", fields: ["id", "currency_code", "total", "raw_total",
    "payment_collection.id", "payment_collection.amount", "payment_collection.raw_amount",
    "payment_collection.payment_sessions.id", "payment_collection.payment_sessions.status",
    "payment_collection.payment_sessions.provider_id", "payment_collection.payment_sessions.amount"],
    filters: { id: fixture.cart.id } })
  const completed = await completeReservedCartWithInventory(container, fixture.authority)
  const links = await findNativeOrdersByCart(knex, fixture.cart.id)
  const orderGraph = await query.graph({ entity: "order", fields: ["id", "currency_code", "version", "total", "raw_total",
    "items.id", "items.variant_id", "items.metadata", "items.raw_unit_price", "items.detail.quantity"],
    filters: { id: completed.orderId } })
  const snapshot = await saveSnapshot([batch.id])
  const allocations = snapshot.allocations.filter((row) => row.order_id === completed.orderId)
  const movements = snapshot.movements.filter((row) => row.reference_id === completed.orderId && row.movement_type === "allocation_conversion")
  events.push({ boundary: "payable-native-completion", cart: cartGraph.data, order: orderGraph.data, links, completed, allocations, movements })
  check("native_payment_workflows_create_test_session", true, { regionId, paymentCollection: paymentCollection.result.id,
    session: session.result, cart: cartGraph.data[0] }, Boolean(session.result?.id) && Boolean(paymentCollection.result?.id))
  check("actual_payable_native_order_created_and_allocated", true, { completed, links, order: orderGraph.data[0], allocations, movements },
    completed.conversionStatus === "allocated" && links.length === 1 && links[0].id === completed.orderId &&
    links[0].cart_id === fixture.cart.id && allocations.length === 2 && movements.length === 2)
}

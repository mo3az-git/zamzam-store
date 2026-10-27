import { validateCartBffRequest, type CartBffOperation, type CartBffResponse, type CartBffSnapshot, type CartBffBlocker, type ContractValidation } from "./cart-bff-contract"

export type GuestCartAuthority = Readonly<{
  status: "owned" | "not_owned" | "expired" | "unavailable"
  /** Server-derived, process-local proof. Never serialize it. */
  cartId?: string
  ownerKey?: string
  proof?: unknown
}>

export type CartOrchestrationSnapshot = Readonly<{
  version: string
  native: unknown
  public: CartBffSnapshot
  lines: readonly { variantId: string; minShelfLifeDays: number | null }[]
  governorateId: string | null
}>

export interface CartBffDependencies {
  /** Must resolve only a server-configured Egypt/EGP region. */
  createOwnedEgpCart(input: { requestId: string }): Promise<{
    cartId: string
    ownerKey: string
    proof: unknown
    sessionSecret: string
    snapshot: CartOrchestrationSnapshot
  }>
  resolveOwnedCart(sessionSecret: string): Promise<GuestCartAuthority>
  readNativeCart(cartId: string, proof: unknown): Promise<CartOrchestrationSnapshot>
  /** Must use the existing native Medusa cart mutation lock and recheck version under that lock. */
  mutateNativeCart(input: { cartId: string; proof: unknown; expectedVersion: string; operation: Exclude<CartBffOperation, { operation: "create" | "read" | "checkout_preflight" }> }): Promise<CartOrchestrationSnapshot>
  /** Durable, owner-scoped request journal; changed request bodies for the same ID must conflict. */
  executeIdempotently<T>(input: { ownerKey: string; requestId: string; fingerprint: string }, work: () => Promise<T>): Promise<T>
  /** Set a Secure, HttpOnly, SameSite cookie in the trusted HTTP adapter; never return the secret in JSON. */
  issueGuestSessionCookie(sessionSecret: string): void
  /** Agent 3 interface. Unknown and errors must remain unknown. */
  readAvailability(lines: CartOrchestrationSnapshot["lines"]): Promise<readonly { variantId: string; status: "available" | "unavailable" | "unknown" }[]>
  /** Agent 5 interface; provider/tariff configuration is server-owned. */
  shippingReadiness(governorateId: string | null, snapshot: CartOrchestrationSnapshot): Promise<readonly CartBffBlocker[]>
  /** Agent 4 interface; describes readiness only, never creates payment or order state. */
  paymentReadiness(method: "cod" | "electronic", snapshot: CartOrchestrationSnapshot): Promise<boolean>
  checkoutReadiness(snapshot: CartOrchestrationSnapshot, proof: unknown): Promise<{
    blockers: readonly CartBffBlocker[]
    status: "blocked" | "ready_for_review"
  }>
}

export type CartBffExecution = Readonly<{
  response: CartBffResponse
  /** True only when the operation was rejected before touching a cart. */
  rejectedBeforeMutation: boolean
}>

const fail = (operation: CartBffOperation["operation"], blocker: CartBffBlocker, cart: CartBffSnapshot | null = null): CartBffExecution => ({
  response: { ok: false, operation, cart, blockers: [blocker], checkout: null }, rejectedBeforeMutation: true,
})
const fingerprint = (operation: CartBffOperation) => JSON.stringify(operation)

/**
 * Execute cart/readiness operations using only server-resolved identity.
 * Intentionally has no "complete", "place_order", or payment execution branch.
 */
export async function executeCartBffRequest(input: {
  body: unknown
  sessionSecret?: string | null
  dependencies: CartBffDependencies
}): Promise<CartBffExecution | ContractValidation<CartBffExecution>> {
  const parsed = validateCartBffRequest(input.body)
  if (!parsed.valid) return parsed
  const operation = parsed.value
  const deps = input.dependencies

  if (operation.operation === "create") {
    try {
      // No pre-existing owner exists to scope a durable deduplication key.
      // Creation is therefore single-shot: the HTTP adapter must not retry an
      // ambiguous timeout; orphan cleanup belongs to the ownership provider.
      const created = await deps.createOwnedEgpCart({ requestId: operation.requestId })
      if (!created.cartId || !created.ownerKey || !created.sessionSecret || !created.proof) return fail(operation.operation, "CART_UNAVAILABLE")
      deps.issueGuestSessionCookie(created.sessionSecret)
      return { response: { ok: true, operation: operation.operation, cart: created.snapshot.public, blockers: [], checkout: null }, rejectedBeforeMutation: false }
    } catch {
      return fail(operation.operation, "UPSTREAM_UNAVAILABLE")
    }
  }

  if (!input.sessionSecret) return fail(operation.operation, "CART_UNAVAILABLE")
  let authority: GuestCartAuthority
  try { authority = await deps.resolveOwnedCart(input.sessionSecret) }
  catch { return fail(operation.operation, "UPSTREAM_UNAVAILABLE") }
  if (authority.status !== "owned" || !authority.cartId || !authority.ownerKey || !authority.proof) {
    return fail(operation.operation, authority.status === "unavailable" ? "UPSTREAM_UNAVAILABLE" : "CART_UNAVAILABLE")
  }

  let current: CartOrchestrationSnapshot
  try { current = await deps.readNativeCart(authority.cartId, authority.proof) }
  catch { return fail(operation.operation, "CART_UNAVAILABLE") }
  if (operation.operation === "read") {
    return { response: { ok: true, operation: operation.operation, cart: current.public, blockers: [], checkout: null }, rejectedBeforeMutation: false }
  }

  if (operation.operation === "checkout_preflight") {
    if (operation.expectedVersion !== current.version) return fail(operation.operation, "CART_VERSION_CONFLICT", current.public)
    try {
      const [availability, shippingBlockers, paymentReady, checkout] = await Promise.all([
        deps.readAvailability(current.lines),
        deps.shippingReadiness(current.governorateId, current),
        deps.paymentReadiness(operation.paymentMethod, current),
        deps.checkoutReadiness(current, authority.proof),
      ])
      const blockers = new Set<CartBffBlocker>(checkout.blockers)
      for (const item of availability) {
        if (item.status === "unknown") blockers.add("INVENTORY_UNKNOWN")
        else if (item.status === "unavailable") blockers.add("INVENTORY_UNAVAILABLE")
      }
      shippingBlockers.forEach((blocker) => blockers.add(blocker))
      if (!paymentReady) blockers.add("PAYMENT_METHOD_UNAVAILABLE")
      const status = blockers.size ? "blocked" : checkout.status
      return { response: { ok: status !== "blocked", operation: operation.operation, cart: current.public,
        blockers: [...blockers], checkout: { status, paymentMethod: operation.paymentMethod } }, rejectedBeforeMutation: true }
    } catch {
      return fail(operation.operation, "UPSTREAM_UNAVAILABLE", current.public)
    }
  }

  if (operation.expectedVersion !== current.version) return fail(operation.operation, "CART_VERSION_CONFLICT", current.public)
  try {
    const updated = await deps.executeIdempotently({ ownerKey: authority.ownerKey, requestId: operation.requestId,
      fingerprint: fingerprint(operation) }, () => deps.mutateNativeCart({ cartId: authority.cartId!, proof: authority.proof,
      expectedVersion: operation.expectedVersion, operation }))
    return { response: { ok: true, operation: operation.operation, cart: updated.public, blockers: [], checkout: null }, rejectedBeforeMutation: false }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : ""
    const blocker: CartBffBlocker = code === "CART_MUTATIONS_LOCKED" || code === "LOCK_TIMEOUT" ? "CART_MUTATION_LOCKED"
      : code === "CART_ALREADY_COMPLETED" ? "CART_COMPLETED"
        : code === "CART_IDEMPOTENCY_CONFLICT" ? "CART_IDEMPOTENCY_CONFLICT"
          : code === "CART_IDEMPOTENCY_UNAVAILABLE" ? "CART_IDEMPOTENCY_UNAVAILABLE"
          : code === "CART_VERSION_CONFLICT" ? "CART_VERSION_CONFLICT" : "UPSTREAM_UNAVAILABLE"
    return fail(operation.operation, blocker, current.public)
  }
}


import { validateCartBffRequest, type CartBffOperation, type CartBffResponse, type CartBffSnapshot, type CartBffBlocker, type ContractValidation } from "./cart-bff-contract"
import type { CheckoutPreflightResult } from "./checkout-preflight-readiness"

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
  /** Server-only composition of ownership, native totals/version, FEFO, shipping, payment and attempt state. */
  checkoutReadiness(input: Readonly<{
    snapshot: CartOrchestrationSnapshot
    cartId: string
    ownershipProof: unknown
    ownerKey: string
    requestId: string
    expectedVersion: string
    paymentMethod: "cod" | "electronic"
  }>): Promise<CheckoutPreflightResult>
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
      const readiness = await deps.checkoutReadiness({
        snapshot: current, cartId: authority.cartId, ownershipProof: authority.proof, ownerKey: authority.ownerKey,
        requestId: operation.requestId, expectedVersion: operation.expectedVersion,
        paymentMethod: operation.paymentMethod,
      })
      if (!readiness || readiness.selectedMethod !== operation.paymentMethod ||
          readiness.cartVersion !== current.version || readiness.orderCompletionAllowed !== false ||
          readiness.paymentExecutionAllowed !== false ||
          !Array.isArray(readiness.blockers) || !readiness.payment ||
          readiness.payment.cod.publicMethodEnabled !== false || readiness.payment.electronic.publicMethodEnabled !== false) {
        return fail(operation.operation, "PREFLIGHT_STATE_UNAVAILABLE", current.public)
      }
      const blockers = readiness.blockers.map((item) => item.code)
      return { response: { ok: readiness.status === "ready_for_review", operation: operation.operation, cart: current.public,
        blockers, checkout: { status: readiness.status, paymentMethod: readiness.selectedMethod,
          blockers: readiness.blockers } }, rejectedBeforeMutation: true }
    } catch {
      return fail(operation.operation, "PREFLIGHT_STATE_UNAVAILABLE", current.public)
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


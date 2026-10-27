/**
 * Internal provider-neutral electronic payment boundary.
 *
 * Contract only: no gateway is selected or invoked, and this module is not
 * mounted on an HTTP route. Callers derive authority from trusted Medusa state.
 */
export type EGPMinorUnits = string & { readonly __brand: "EGPMinorUnits" }

export type ElectronicPaymentIntentRequest = Readonly<{
  checkoutAttemptId: string
  idempotencyKey: string
  amountMinor: EGPMinorUnits
  currencyCode: "EGP"
  orderReference: string
  /** Server-configured destinations only; never browser supplied. */
  returnUrl?: string
}>

export type ElectronicPaymentIntentResult = Readonly<{
  providerKey: string
  providerPaymentId: string
  status: "initiated" | "authorized" | "outcome_unknown"
  /** Optional hosted redirect; validate host against provider configuration. */
  redirectUrl?: string
}>

export type NormalizedProviderPaymentEvent = Readonly<{
  providerKey: string
  providerEventId: string
  checkoutAttemptId: string
  providerPaymentId: string
  status: "authorized" | "paid" | "failed" | "outcome_unknown" | "voided" | "partially_refunded" | "refunded"
  amountMinor: EGPMinorUnits
  currencyCode: "EGP"
  occurredAt: string
  /** Digest of normalized signed identity; never raw request data. */
  eventDigest: string
  /** Monotonic provider revision when supported; otherwise reconcile out of order. */
  providerRevision?: string
}>

export type ElectronicPaymentStatusResult = Readonly<{
  providerKey: string
  providerPaymentId: string
  checkoutAttemptId: string
  status: "initiated" | "authorized" | "paid" | "failed" | "outcome_unknown" | "voided" | "partially_refunded" | "refunded"
  amountMinor: EGPMinorUnits
  currencyCode: "EGP"
}>

/**
 * Implementations use only server-owned authority. verifyAndNormalizeEvent
 * authenticates raw provider bytes before returning normalized event data.
 */
export interface ElectronicPaymentProviderAdapter {
  readonly providerKey: string

  createOrRetrieveIntent(
    request: ElectronicPaymentIntentRequest
  ): Promise<ElectronicPaymentIntentResult>

  verifyAndNormalizeEvent(input: Readonly<{
    rawBody: Uint8Array
    headers: Readonly<Record<string, string | string[] | undefined>>
    receivedAt: string
  }>): Promise<NormalizedProviderPaymentEvent>

  retrieveStatus(input: Readonly<{
    providerPaymentId: string
    checkoutAttemptId: string
    idempotencyKey: string
  }>): Promise<ElectronicPaymentStatusResult>
}

/**
 * Adapters preserve exact minor-unit strings. Number arithmetic, caller-
 * selected providers, and inferred success states are outside this contract.
 */


/**
 * Internal capability snapshot for checkout orchestration.
 * This is descriptive only: it cannot enable a public method or settle payment.
 */
export type PaymentBranchReadiness = Readonly<{
  method: "cod" | "electronic"
  internallyAvailable: boolean
  publicMethodEnabled: false
  settlementEnabled: false
  blockers: readonly (
    | "COD_COLLECTION_AUTHORITY_REQUIRED"
    | "GATEWAY_NOT_SELECTED"
    | "AUTHENTICATED_ADAPTER_NOT_CONFIGURED"
    | "NATIVE_MEDUSA_PAYMENT_SYNC_REQUIRED"
  )[]
}>

export type PaymentReadinessSnapshot = Readonly<{
  cod: PaymentBranchReadiness
  electronic: PaymentBranchReadiness
}>

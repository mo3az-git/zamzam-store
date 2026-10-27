/**
 * Governorate-Based Delivery Pricing UI Adapter (Phase 4.8)
 *
 * Client & Server safe:
 * - Pure UI adapter for presenting governorate shipping quotes.
 * - Distinguishes 4 presentation states:
 *     1. shipping_rate_unconfigured (selected governorate has no approved store rate)
 *     2. shipping_quote_pending (governorate not yet selected or awaiting quotation)
 *     3. shipping_quote_unavailable (quote calculation failed, conflicting, or non-EGP)
 *     4. shipping_ready (authoritative backend EGP quote available)
 *
 * Security & Architectural Invariants:
 * - Does NOT fabricate delivery amounts or assume delivery is free when no price exists.
 * - Does NOT perform browser-side math (e.g. subtotal + estimated delivery).
 * - Does NOT activate checkout, payment, or order placement.
 * - Fails closed on: unknown statuses, non-EGP currencies, conflicting governorates,
 *   malformed payloads, or unapproved quote formats.
 */

import type { Dictionary, Locale } from "./i18n.ts"
import { formatEgpAmount } from "./medusa.ts"
import { isValidGovernorate } from "./checkout.ts"

export type ShippingPresentationStatus =
  | "shipping_quote_pending"
  | "shipping_rate_unconfigured"
  | "shipping_quote_unavailable"
  | "shipping_ready"

export interface BackendShippingQuote {
  governorate?: unknown
  status?: unknown
  currency?: unknown
  amount?: unknown
  blocker?: unknown
}

export interface ShippingUiPresentation {
  status: ShippingPresentationStatus
  statusLabel: string
  notice: string
  formattedAmount: string | null
  rawAmount: number | null
  isReady: boolean
  isBlocked: boolean
  blockerCode?: string
}

/**
 * Validates and adapts a normalized backend shipping quote into the localized UI view-model.
 * Fails closed on any unexpected, conflicting, or non-EGP response.
 */
export function adaptShippingQuoteToUi(
  rawQuote: unknown,
  selectedGovernorate: string | null | undefined,
  dict: Dictionary,
  locale: Locale
): ShippingUiPresentation {
  // 1. If no valid governorate is selected, presentation is strictly pending selection
  if (!selectedGovernorate || !isValidGovernorate(selectedGovernorate)) {
    return {
      status: "shipping_quote_pending",
      statusLabel: dict.checkout.shippingStates.shipping_quote_pending,
      notice: dict.checkout.shippingStateNotices.shipping_quote_pending,
      formattedAmount: null,
      rawAmount: null,
      isReady: false,
      isBlocked: true,
    }
  }

  const normalizedGov = selectedGovernorate.trim().toLowerCase()

  // 2. If no quote payload is provided, rate is unconfigured for this governorate
  if (!rawQuote || typeof rawQuote !== "object") {
    return {
      status: "shipping_rate_unconfigured",
      statusLabel: dict.checkout.shippingStates.shipping_rate_unconfigured,
      notice: dict.checkout.shippingStateNotices.shipping_rate_unconfigured,
      formattedAmount: null,
      rawAmount: null,
      isReady: false,
      isBlocked: true,
    }
  }

  const quote = rawQuote as BackendShippingQuote

  // 3. Validate governorate consistency: Conflicting response must fail closed
  if (
    typeof quote.governorate === "string" &&
    quote.governorate.trim().toLowerCase() !== normalizedGov
  ) {
    return {
      status: "shipping_quote_unavailable",
      statusLabel: dict.checkout.shippingStates.shipping_quote_unavailable,
      notice: dict.checkout.shippingStateNotices.shipping_quote_unavailable,
      formattedAmount: null,
      rawAmount: null,
      isReady: false,
      isBlocked: true,
      blockerCode: "SHIPPING_PRICE_UNAVAILABLE",
    }
  }

  // 4. Validate Currency: Must be strictly EGP
  if (quote.currency !== undefined && quote.currency !== null) {
    if (typeof quote.currency !== "string" || quote.currency.trim().toUpperCase() !== "EGP") {
      return {
        status: "shipping_quote_unavailable",
        statusLabel: dict.checkout.shippingStates.shipping_quote_unavailable,
        notice: dict.checkout.shippingStateNotices.shipping_quote_unavailable,
        formattedAmount: null,
        rawAmount: null,
        isReady: false,
        isBlocked: true,
        blockerCode: "CART_CURRENCY_NOT_EGP",
      }
    }
  }

  // 5. Evaluate Backend Status
  const statusStr = typeof quote.status === "string" ? quote.status.trim().toLowerCase() : ""

  if (statusStr === "ready") {
    // Valid ready quote requires a valid finite non-negative number and EGP currency
    const amount = quote.amount
    const isCurrencyValid =
      quote.currency == null ||
      (typeof quote.currency === "string" && quote.currency.trim().toUpperCase() === "EGP")
    const isAmountValid =
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount >= 0 &&
      isCurrencyValid

    if (!isAmountValid) {
      // Malformed amount cannot be accepted as ready
      return {
        status: "shipping_quote_unavailable",
        statusLabel: dict.checkout.shippingStates.shipping_quote_unavailable,
        notice: dict.checkout.shippingStateNotices.shipping_quote_unavailable,
        formattedAmount: null,
        rawAmount: null,
        isReady: false,
        isBlocked: true,
        blockerCode: "SHIPPING_PRICE_UNAVAILABLE",
      }
    }

    const formatted = formatEgpAmount(amount, locale)
    return {
      status: "shipping_ready",
      statusLabel: dict.checkout.shippingStates.shipping_ready,
      notice: dict.checkout.shippingStateNotices.shipping_ready,
      formattedAmount: formatted,
      rawAmount: amount,
      isReady: true,
      isBlocked: false,
    }
  }

  if (statusStr === "unconfigured") {
    return {
      status: "shipping_rate_unconfigured",
      statusLabel: dict.checkout.shippingStates.shipping_rate_unconfigured,
      notice: dict.checkout.shippingStateNotices.shipping_rate_unconfigured,
      formattedAmount: null,
      rawAmount: null,
      isReady: false,
      isBlocked: true,
      blockerCode: typeof quote.blocker === "string" ? quote.blocker : undefined,
    }
  }

  if (statusStr === "pending") {
    return {
      status: "shipping_quote_pending",
      statusLabel: dict.checkout.shippingStates.shipping_quote_pending,
      notice: dict.checkout.shippingStateNotices.shipping_quote_pending,
      formattedAmount: null,
      rawAmount: null,
      isReady: false,
      isBlocked: true,
      blockerCode: typeof quote.blocker === "string" ? quote.blocker : undefined,
    }
  }

  // Any unknown status or "unavailable" fails closed to shipping_quote_unavailable
  return {
    status: "shipping_quote_unavailable",
    statusLabel: dict.checkout.shippingStates.shipping_quote_unavailable,
    notice: dict.checkout.shippingStateNotices.shipping_quote_unavailable,
    formattedAmount: null,
    rawAmount: null,
    isReady: false,
    isBlocked: true,
    blockerCode: typeof quote.blocker === "string" ? quote.blocker : "SHIPPING_PRICE_UNAVAILABLE",
  }
}

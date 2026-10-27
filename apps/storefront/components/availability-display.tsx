import { getDictionary, type Locale } from "../lib/i18n"
import { normalizeAvailabilityStatus, type AvailabilityStatus } from "../lib/availability"

export interface AvailabilityDisplayProps {
  status?: unknown
  locale: Locale
  className?: string
}

/**
 * Reusable, accessible, bilingual availability display component.
 *
 * Supports statuses:
 * - "available"
 * - "unavailable"
 * - "unknown" (default for missing, null, or invalid status)
 *
 * Adheres strictly to the safety rules:
 * - Read-only status presentation; no Add to Cart, checkout, or cart mutations.
 * - ARIA live region (`role="status"`, `aria-live="polite"`) for reactive variant selection.
 * - Bilingual RTL/LTR support.
 */
export function AvailabilityDisplay({
  status,
  locale,
  className = "",
}: AvailabilityDisplayProps) {
  const dict = getDictionary(locale)
  const resolvedStatus: AvailabilityStatus = normalizeAvailabilityStatus(status)
  const statusInfo = dict.availability[resolvedStatus]

  return (
    <div
      className={`lux-availability ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-availability-status={resolvedStatus}
    >
      <div className="lux-availability-header">
        <span className="lux-availability-title">{dict.availability.heading}</span>
        <span className={`lux-availability-badge is-${resolvedStatus}`}>
          <span className="lux-availability-dot" aria-hidden="true" />
          <span className="lux-availability-label">{statusInfo.label}</span>
        </span>
      </div>
      <p className="lux-availability-desc">{statusInfo.description}</p>
      <p className="lux-availability-disclaimer">{dict.availability.disclaimer}</p>
    </div>
  )
}

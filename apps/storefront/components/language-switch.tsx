"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  alternateLocale,
  buildLanguageSwitchHref,
  localeDirection,
  localeLabel,
  type Locale,
} from "../lib/i18n"

export interface LanguageSwitchProps {
  currentLocale: Locale
  ariaLabel: string
  initialHref?: string
}

/**
 * Dynamic Client-Side Language Switcher (DEF-02)
 *
 * App Router layouts persist across client-side page transitions, making
 * static header links stale. Use App Router's reactive pathname and search
 * parameters as the single source of truth to guarantee
 * that switching language preserves the current product path, filters, query,
 * and variant parameters.
 */
export function LanguageSwitch({
  currentLocale,
  ariaLabel,
  initialHref,
}: LanguageSwitchProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const targetLocale = alternateLocale(currentLocale)

  // Next.js App Router patches the native history API, so useSearchParams
  // updates on both <Link> transitions and variant history.replaceState().
  // A separate mount-only window.search cache would mask later client routing.
  const search = searchParams?.toString() ?? ""
  const searchToUse = search ? `?${search}` : ""

  const href = pathname
    ? buildLanguageSwitchHref(currentLocale, pathname, searchToUse)
    : initialHref ?? (currentLocale === "ar" ? "/en" : "/")

  return (
    <Link
      className="lux-lang"
      href={href}
      hrefLang={targetLocale}
      lang={targetLocale}
      dir={localeDirection[targetLocale]}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className="lux-lang-icon" aria-hidden="true">
        🌐
      </span>
      <span>{localeLabel[targetLocale]}</span>
    </Link>
  )
}

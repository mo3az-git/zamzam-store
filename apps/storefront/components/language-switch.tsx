"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
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
 * static header links stale. This component reacts to `usePathname()` and
 * `useSearchParams()` (as well as client-side URL history updates) to guarantee
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

  // Track client search string reactively (including popstate triggered by URL replaceState)
  const [clientSearch, setClientSearch] = useState<string | null>(null)

  useEffect(() => {
    const syncSearch = () => {
      setClientSearch(window.location.search)
    }
    syncSearch()
    window.addEventListener("popstate", syncSearch)
    return () => window.removeEventListener("popstate", syncSearch)
  }, [])

  const searchToUse =
    clientSearch !== null
      ? clientSearch
      : searchParams
      ? `?${searchParams.toString()}`
      : ""

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

import type { Metadata } from "next"
import { localePath, type Locale } from "./i18n.ts"

/**
 * Absolute base URL for canonical links, hreflang alternates and Open Graph.
 * `NEXT_PUBLIC_SITE_URL` must be set for any deployed environment; the loopback
 * fallback only keeps local builds warning-free and is never a published claim.
 */
export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) {
    try {
      return new URL(configured)
    } catch {
      // fall through to the development default
    }
  }
  return new URL("http://localhost:8000")
}

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString()
}

/** Canonical + hreflang alternates for one locale-independent path. */
export function localeAlternates(path: string, locale: Locale): Metadata["alternates"] {
  return {
    canonical: localePath(locale, path),
    languages: {
      ar: localePath("ar", path),
      en: localePath("en", path),
    },
  }
}

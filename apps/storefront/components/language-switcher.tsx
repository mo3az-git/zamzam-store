import Link from "next/link"
import { getEquivalentPath, type Locale } from "../lib/i18n"

export { getEquivalentPath }

export function LanguageSwitcher({
  currentLocale,
  currentPath = "/",
}: {
  currentLocale: Locale
  currentPath?: string
}) {
  const targetLocale: Locale = currentLocale === "ar" ? "en" : "ar"
  const targetUrl = getEquivalentPath(currentPath, targetLocale)
  const label = targetLocale === "en" ? "English" : "العربية"
  const ariaLabel = targetLocale === "en" ? "Switch language to English" : "تغيير اللغة إلى العربية"

  return (
    <Link
      href={targetUrl}
      className="lux-lang-switch"
      aria-label={ariaLabel}
      title={ariaLabel}
      lang={targetLocale}
      dir={targetLocale === "ar" ? "rtl" : "ltr"}
    >
      <span className="lux-lang-icon" aria-hidden="true">🌐</span>
      <span className="lux-lang-text">{label}</span>
    </Link>
  )
}

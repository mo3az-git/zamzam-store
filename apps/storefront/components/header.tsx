import Link from "next/link"
import { getDictionary, type Locale } from "../lib/i18n"
import { LanguageSwitcher } from "./language-switcher"

export function Header({
  locale = "ar",
  currentPath = "/",
}: {
  locale?: Locale
  currentPath?: string
}) {
  const dict = getDictionary(locale)
  const isEn = locale === "en"
  const homePath = isEn ? "/en" : "/"
  const productsPath = isEn ? "/en/products" : "/products"
  const collectionsHash = isEn ? "/en#lux-collections" : "/#lux-collections"

  return (
    <>
      <a className="lux-skip-link" href="#main-content">
        {dict.nav.skipToContent}
      </a>
      <div className="lux-topbar">
        <div className="shell lux-topbar-content">
          <span>{isEn ? "Welcome to Zamzam Store" : "أهلًا بك في زمزم ستور"}</span>
          <span className="lux-topbar-en">
            {dict.brand.subtext} <span aria-hidden="true">✦</span> {dict.brand.edition}
          </span>
        </div>
      </div>
      <header className="lux-header">
        <div className="shell lux-nav">
          <Link href={homePath} className="lux-brand" aria-label={`${dict.brand.name} — ${dict.nav.home}`}>
            <span className="lux-brand-mark" aria-hidden="true">ز</span>
            <span className="lux-brand-name">
              {dict.brand.name} <small>{dict.brand.nameTranslit}</small>
            </span>
          </Link>
          <nav className="lux-primary-nav" aria-label={isEn ? "Main navigation" : "التنقل الرئيسي"}>
            <Link href={homePath}>{dict.nav.home}</Link>
            <Link href={productsPath}>{dict.nav.store}</Link>
            <Link href={collectionsHash}>{dict.nav.collections}</Link>
          </nav>
          <div className="lux-header-actions">
            <LanguageSwitcher currentLocale={locale} currentPath={currentPath} />
            <Link className="lux-header-action" href={productsPath}>
              <span>{dict.nav.discoverProducts}</span>
              <span className="lux-arrow-icon" aria-hidden="true">{isEn ? "↗" : "↖"}</span>
            </Link>
          </div>
        </div>
      </header>
    </>
  )
}

import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { notFound } from "next/navigation"
import "../globals.css"
import {
  alternateLocale,
  getDictionary,
  isLocale,
  localeDirection,
  localeLabel,
  localePath,
  stripLocale,
} from "../../lib/i18n"
import { localeAlternates, siteUrl } from "../../lib/site"

type LocaleParams = { locale: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const dict = getDictionary(locale)
  return {
    metadataBase: siteUrl(),
    title: dict.meta.title,
    description: dict.meta.description,
    applicationName: dict.brand.name,
    alternates: localeAlternates("/", locale),
    openGraph: {
      type: "website",
      siteName: dict.brand.name,
      title: dict.meta.title,
      description: dict.meta.description,
      locale: locale === "ar" ? "ar_EG" : "en_EG",
    },
  }
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b211d",
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<LocaleParams> }>) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)
  const requestHeaders = await headers()
  const originalPath = requestHeaders.get("x-zamzam-pathname") ?? "/"
  const search = requestHeaders.get("x-zamzam-search") ?? ""
  const switchLocale = alternateLocale(locale)
  const switchHref = `${localePath(switchLocale, stripLocale(originalPath))}${search}`

  const home = localePath(locale, "/")
  const catalog = localePath(locale, "/products")
  const collections = `${home}#lux-collections`

  return (
    <html lang={locale} dir={localeDirection[locale]}>
      <body>
        <a className="lux-skip-link" href="#main-content">
          {dict.a11y.skip}
        </a>
        <div className="lux-topbar">
          <div className="shell lux-topbar-content">
            <span>{dict.topbar.welcome}</span>
            <span className="lux-topbar-en" aria-hidden="true">
              {dict.topbar.tagline}
            </span>
            <Link
              className="lux-lang"
              href={switchHref}
              hrefLang={switchLocale}
              lang={switchLocale}
              dir={localeDirection[switchLocale]}
              aria-label={dict.language.switchTo}
              title={dict.language.switchTo}
            >
              <span className="lux-lang-icon" aria-hidden="true">🌐</span>
              <span>{localeLabel[switchLocale]}</span>
            </Link>
          </div>
        </div>
        <header className="lux-header">
          <div className="shell lux-nav">
            <Link href={home} className="lux-brand" aria-label={dict.brand.homeLabel}>
              <span className="lux-brand-mark" aria-hidden="true">
                ز
              </span>
              <span className="lux-brand-name">
                {dict.brand.name} <small>{dict.brand.sub}</small>
              </span>
            </Link>
            <nav className="lux-primary-nav" aria-label={dict.nav.label}>
              <Link href={home}>{dict.nav.home}</Link>
              <Link href={catalog}>{dict.nav.shop}</Link>
              <Link href={collections}>{dict.nav.collections}</Link>
            </nav>
            <Link className="lux-header-action" href={catalog}>
              {dict.nav.discover}
              <span aria-hidden="true">{locale === "en" ? "↗" : "↖"}</span>
            </Link>
          </div>
        </header>
        {children}
        <footer className="lux-footer">
          <div className="shell">
            <div className="lux-footer-grid">
              <div className="lux-footer-about">
                <span className="lux-eyebrow">{dict.footer.eyebrow}</span>
                <strong>
                  {dict.footer.titleLead}
                  <br />
                  <span>{dict.footer.titleAccent}</span>
                </strong>
                <p>{dict.footer.body}</p>
              </div>
              <nav className="lux-footer-links" aria-label={dict.footer.linksLabel}>
                <span>{dict.footer.linksLabel}</span>
                <Link href={home}>
                  {dict.footer.home} <span aria-hidden="true">↗</span>
                </Link>
                <Link href={catalog}>
                  {dict.footer.products} <span aria-hidden="true">↗</span>
                </Link>
                <Link href={collections}>
                  {dict.footer.collections} <span aria-hidden="true">↗</span>
                </Link>
              </nav>
              <div className="lux-footer-mark" aria-hidden="true">
                ز
              </div>
            </div>
            <div className="lux-footer-bottom">
              <span>{dict.footer.rights(new Date().getFullYear())}</span>
              <span>{dict.footer.identity}</span>
              <span className="lux-footer-en" dir="ltr">
                ZAMZAM / EGYPT
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}

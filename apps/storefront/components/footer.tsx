import Link from "next/link"
import { getDictionary, type Locale } from "../lib/i18n"

export function Footer({ locale = "ar" }: { locale?: Locale }) {
  const dict = getDictionary(locale)
  const isEn = locale === "en"
  const homePath = isEn ? "/en" : "/"
  const productsPath = isEn ? "/en/products" : "/products"
  const collectionsHash = isEn ? "/en#lux-collections" : "/#lux-collections"

  return (
    <footer className="lux-footer">
      <div className="shell">
        <div className="lux-footer-grid">
          <div className="lux-footer-about">
            <span className="lux-eyebrow">{dict.footer.eyebrow}</span>
            <strong>
              {dict.footer.headline}<br />
              <span>{dict.footer.headlineSpan}</span>
            </strong>
            <p>{dict.footer.about}</p>
          </div>
          <nav className="lux-footer-links" aria-label={isEn ? "Store links" : "روابط المتجر"}>
            <span>{dict.footer.quickLinks}</span>
            <Link href={homePath}>
              {dict.footer.home} <span aria-hidden="true">{isEn ? "↗" : "↗"}</span>
            </Link>
            <Link href={productsPath}>
              {dict.footer.products} <span aria-hidden="true">{isEn ? "↗" : "↗"}</span>
            </Link>
            <Link href={collectionsHash}>
              {dict.footer.collections} <span aria-hidden="true">{isEn ? "↗" : "↗"}</span>
            </Link>
          </nav>
          <div className="lux-footer-mark" aria-hidden="true">ز</div>
        </div>
        <div className="lux-footer-bottom">
          <span>{dict.footer.copyright(new Date().getFullYear())}</span>
          <span>{dict.footer.identity}</span>
          <span className="lux-footer-en">{dict.footer.location}</span>
        </div>
      </div>
    </footer>
  )
}

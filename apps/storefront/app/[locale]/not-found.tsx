import { headers } from "next/headers"
import Link from "next/link"
import { getDictionary, localeFromPathname, localePath } from "../../lib/i18n"

export default async function NotFound() {
  const requestHeaders = await headers()
  const locale = localeFromPathname(requestHeaders.get("x-zamzam-pathname") ?? "/")
  const dict = getDictionary(locale)

  return (
    <main className="shell catalog-page" id="main-content">
      <div className="notice not-found" role="status">
        <span className="lux-eyebrow">404</span>
        <strong>{dict.notFound.title}</strong>
        <p>{dict.notFound.body}</p>
        <Link href={localePath(locale, "/")} className="button button-secondary">
          {dict.notFound.cta}
        </Link>
      </div>
    </main>
  )
}

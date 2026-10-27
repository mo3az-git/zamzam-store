import { NextResponse, type NextRequest } from "next/server"
import { defaultLocale, stripLocale } from "./lib/i18n"

const REWRITTEN_HEADER = "x-zamzam-rewritten"
const PATH_HEADER = "x-zamzam-pathname"
const SEARCH_HEADER = "x-zamzam-search"

/**
 * Language routing.
 *
 * Arabic is the default and stays unprefixed (`/products`), English lives under
 * `/en` (`/en/products`). Unprefixed requests are rewritten into the `[locale]`
 * segment so the public Arabic URL stays clean while both locales share one
 * implementation. An explicit `/ar/...` URL redirects to its canonical form.
 *
 * The rewritten request passes through this middleware again, so it is marked
 * to keep the canonicalisation rule from bouncing it back to the public path.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const headers = new Headers(request.headers)
  const internal = headers.get(REWRITTEN_HEADER) === "1"

  // Preserve the original public path for the language switch and 404 copy.
  if (!headers.get(PATH_HEADER)) headers.set(PATH_HEADER, pathname)
  if (!headers.get(SEARCH_HEADER)) headers.set(SEARCH_HEADER, search)

  if (internal) return NextResponse.next({ request: { headers } })

  if (pathname === "/ar" || pathname.startsWith("/ar/")) {
    const canonical = request.nextUrl.clone()
    canonical.pathname = stripLocale(pathname)
    return NextResponse.redirect(canonical, 308)
  }

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    return NextResponse.next({ request: { headers } })
  }

  headers.set(REWRITTEN_HEADER, "1")
  const rewritten = request.nextUrl.clone()
  rewritten.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`
  return NextResponse.rewrite(rewritten, { request: { headers } })
}

export const config = {
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
}

import { NextResponse, type NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isEn = pathname === "/en" || pathname.startsWith("/en/")
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-locale", isEn ? "en" : "ar")
  requestHeaders.set("x-dir", isEn ? "ltr" : "rtl")
  requestHeaders.set("x-pathname", pathname)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}

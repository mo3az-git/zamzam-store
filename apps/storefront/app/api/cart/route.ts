import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const COOKIE_NAME = "zamzam_guest_cart"
const COOKIE_PATH = "/api/cart"
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MAX_REQUEST_BYTES = 16384
const MAX_RESPONSE_BYTES = 131072

function blocked(status = 404) {
  return NextResponse.json({ error: "CART_UNAVAILABLE" }, {
    status, headers: { "Cache-Control": "no-store" },
  })
}

function configuredOrigin(): string | null {
  const raw = process.env.ZAMZAM_STOREFRONT_ORIGIN?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!["https:", "http:"].includes(url.protocol) || url.username ||
        url.password || url.search || url.hash || url.pathname !== "/" ||
        url.origin !== raw.replace(/\/$/, "")) return null
    return url.origin
  } catch { return null }
}

function configuredBackend(): URL | null {
  const raw = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!["https:", "http:"].includes(url.protocol) || url.username ||
        url.password || url.search || url.hash || url.pathname !== "/") return null
    return new URL("/store/cart-bff", url)
  } catch { return null }
}

function incomingSession(request: NextRequest): { value: string | null; valid: boolean } {
  const raw = request.headers.get("cookie") ?? ""
  if (raw.length > 8192) return { value: null, valid: false }
  const matches = raw.split(";").map(part => part.trim())
    .filter(part => part.startsWith(COOKIE_NAME + "="))
  if (matches.length > 1) return { value: null, valid: false }
  if (!matches.length) return { value: null, valid: true }
  const value = matches[0].slice(COOKIE_NAME.length + 1)
  return { value, valid: SESSION_PATTERN.test(value) }
}

function returnedSession(headers: Headers): { value: string; maxAge: number } | null {
  const cookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (headers.get("set-cookie") ? [headers.get("set-cookie")!] : [])
  const match = cookies.map(cookie => {
    const value = new RegExp("(?:^|,\\s*)" + COOKIE_NAME + "=([A-Za-z0-9_-]{43})(?:;|$)").exec(cookie)?.[1]
    const age = /(?:^|;)\s*Max-Age=(\d+)/i.exec(cookie)?.[1]
    const maxAge = age ? Number(age) : 86400
    return value && SESSION_PATTERN.test(value) && Number.isSafeInteger(maxAge) &&
      maxAge >= 1 ? { value, maxAge: Math.min(maxAge, 86400) } : null
  }).filter((cookie): cookie is { value: string; maxAge: number } => cookie !== null)
  return match.length === 1 ? match[0] : null
}

/**
 * The browser sees only this same-origin endpoint. The trusted proxy resolves
 * its guest proof from the HttpOnly cookie and never exposes cart IDs/secrets.
 * Completing an order is deliberately unsupported.
 */
export async function POST(request: NextRequest) {
  if (process.env.ZAMZAM_CART_BFF_ENABLED !== "true") return blocked(503)
  const origin = configuredOrigin()
  const target = configuredBackend()
  const apiKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY?.trim()
  if (!origin || !target || !apiKey) return blocked(503)
  if (request.headers.get("origin") !== origin ||
      request.nextUrl.origin !== origin ||
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      !/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return blocked()
  }
  const session = incomingSession(request)
  if (!session.valid) return blocked()
  let body: string
  try {
    body = await request.text()
    if (!body || Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) return blocked(413)
    const value: unknown = JSON.parse(body)
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !("operation" in value) || typeof value.operation !== "string" ||
        !["create", "read", "add_item", "update_item", "remove_item", "set_delivery", "checkout_preflight"].includes(value.operation)) {
      return blocked(400)
    }
  } catch { return blocked(400) }

  try {
    const headers: Record<string, string> = {
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-zamzam-cart-csrf": "1",
      "x-publishable-api-key": apiKey,
      accept: "application/json",
    }
    if (session.value) headers.cookie = COOKIE_NAME + "=" + session.value
    const upstream = await fetch(target.toString(), {
      method: "POST", body, headers,
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10000),
    })
    if (upstream.status >= 300 && upstream.status < 400) return blocked(502)
    const raw = await upstream.text()
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) return blocked(502)
    let data: unknown
    try { data = JSON.parse(raw) } catch { return blocked(502) }
    const response = NextResponse.json(data, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    })
    const issued = returnedSession(upstream.headers)
    const isCreation = body.includes('"operation":"create"')
    if (upstream.ok && isCreation && !session.value && !issued) return blocked(503)
    if (issued) response.cookies.set(COOKIE_NAME, issued.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: issued.maxAge,
    })
    return response
  } catch { return blocked(503) }
}

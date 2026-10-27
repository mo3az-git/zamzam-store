import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CartView } from "../../../components/cart-view"
import { getDictionary, isLocale, type Locale } from "../../../lib/i18n"
import { localeAlternates, siteUrl } from "../../../lib/site"

type CartPageParams = { locale: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<CartPageParams>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}

  const dict = getDictionary(locale)
  return {
    metadataBase: siteUrl(),
    title: `${dict.cart.title} | ${dict.brand.name}`,
    description: dict.cart.nonProductionNotice,
    alternates: localeAlternates("/cart", locale as Locale),
  }
}

export default async function CartPage({
  params,
}: {
  params: Promise<CartPageParams>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  return (
    <main>
      <Suspense fallback={<div className="shell lux-cart-page" />}>
        <CartView locale={locale as Locale} />
      </Suspense>
    </main>
  )
}

import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CheckoutView } from "../../../components/checkout-view"
import { getDictionary, isLocale, type Locale } from "../../../lib/i18n"
import { isServerQaPreview } from "../../../lib/qa-preview"
import { localeAlternates, siteUrl } from "../../../lib/site"

type CheckoutPageParams = { locale: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<CheckoutPageParams>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}

  const dict = getDictionary(locale)
  return {
    metadataBase: siteUrl(),
    title: `${dict.checkout.title} | ${dict.brand.name}`,
    description: dict.checkout.subtitle,
    alternates: localeAlternates("/checkout", locale as Locale),
  }
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<CheckoutPageParams>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  // Server-verified QA preview check (gated strictly by VERCEL_ENV=preview & ZAMZAM_SYNTHETIC_PREVIEW=true)
  const isQaMode = isServerQaPreview()

  return (
    <main>
      <Suspense fallback={<div className="shell lux-checkout-page" />}>
        <CheckoutView locale={locale as Locale} isQaMode={isQaMode} />
      </Suspense>
    </main>
  )
}

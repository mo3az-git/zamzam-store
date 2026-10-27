import type { Metadata } from "next"
import { headers } from "next/headers"
import "./globals.css"
import { Header } from "../components/header"
import { Footer } from "../components/footer"
import { DirSync } from "../components/dir-sync"
import type { Locale } from "../lib/i18n"

export const metadata: Metadata = {
  title: "زمزم ستور | تفاصيل تليق بذوقك",
  description: "زمزم ستور: تجربة عربية راقية لتصفح مياه زمزم المعبأة والتمور، مع بيانات وأسعار من كتالوج Medusa.",
  alternates: {
    languages: {
      ar: "/",
      en: "/en",
    },
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const headerList = await headers()
  const rawLocale = headerList.get("x-locale")
  const locale: Locale = rawLocale === "en" ? "en" : "ar"
  const dir: "rtl" | "ltr" = locale === "en" ? "ltr" : "rtl"
  const currentPath = headerList.get("x-pathname") || (locale === "en" ? "/en" : "/")

  return (
    <html lang={locale} dir={dir}>
      <body>
        <DirSync locale={locale} dir={dir} />
        <Header locale={locale} currentPath={currentPath} />
        {children}
        <Footer locale={locale} />
      </body>
    </html>
  )
}

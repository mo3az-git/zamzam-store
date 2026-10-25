import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Zamzam Store — Technical Scaffold",
  description: "Phase 1 technical compatibility scaffold. Store features are not implemented."
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}

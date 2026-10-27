import type { Metadata } from "next"
import { CatalogContent } from "../../../components/catalog-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Products | Zamzam Store",
  description: "Browse Zamzam Store product catalog and authoritative prices directly from the store system in EGP.",
  alternates: {
    languages: {
      ar: "/products",
      en: "/en/products",
    },
  },
}

export default async function EnglishProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; category?: string }>
}) {
  return <CatalogContent searchParams={searchParams} locale="en" />
}

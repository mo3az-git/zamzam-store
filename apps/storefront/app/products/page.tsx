import type { Metadata } from "next"
import { CatalogContent } from "../../components/catalog-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "المنتجات | زمزم ستور",
  description: "تصفح كتالوج منتجات زمزم ستور وأسعارها المتاحة من نظام المتجر بالجنيه المصري.",
  alternates: {
    languages: {
      ar: "/products",
      en: "/en/products",
    },
  },
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; category?: string }>
}) {
  return <CatalogContent searchParams={searchParams} locale="ar" />
}

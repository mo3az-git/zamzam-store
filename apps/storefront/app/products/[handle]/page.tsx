import type { Metadata } from "next"
import { listStoreProducts } from "../../../lib/medusa"
import { ProductDetailContent } from "../../../components/product-detail-content"

export const dynamic = "force-dynamic"

type ProductParams = { handle: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<ProductParams>
}): Promise<Metadata> {
  const { handle } = await params
  const result = await listStoreProducts({ handle, limit: 1 })
  const product = result.products.find((item) => item.handle === handle)
  return {
    title: product ? `${product.title} | زمزم ستور` : "تفاصيل المنتج | زمزم ستور",
    description: product?.description?.slice(0, 160) || "تفاصيل المنتج في زمزم ستور",
    alternates: {
      languages: {
        ar: `/products/${encodeURIComponent(handle)}`,
        en: `/en/products/${encodeURIComponent(handle)}`,
      },
    },
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<ProductParams>
}) {
  const { handle } = await params
  return <ProductDetailContent handle={handle} locale="ar" />
}

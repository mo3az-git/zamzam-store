import type { Metadata } from "next"
import { HomeContent } from "../components/home-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "زمزم ستور | تفاصيل تليق بذوقك",
  description: "مساحة عربية مختارة لتصفّح مياه زمزم المعبأة والتمور الفاخرة؛ تفاصيل واضحة، وهوية هادئة، ومنتجات تُعرض مباشرة من كتالوج المتجر.",
  alternates: {
    languages: {
      ar: "/",
      en: "/en",
    },
  },
}

export default async function Home() {
  return <HomeContent locale="ar" />
}

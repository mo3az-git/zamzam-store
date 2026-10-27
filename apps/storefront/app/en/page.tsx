import type { Metadata } from "next"
import { HomeContent } from "../../components/home-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Zamzam Store | Crafted with Heritage and Purpose",
  description: "A refined space to discover authenticated packaged Zamzam water and luxury dates directly from the official store catalog in Egypt.",
  alternates: {
    languages: {
      ar: "/",
      en: "/en",
    },
  },
}

export default async function EnglishHome() {
  return <HomeContent locale="en" />
}

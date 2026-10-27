export type Locale = "ar" | "en"

export type Dictionary = {
  locale: Locale
  dir: "rtl" | "ltr"
  brand: {
    name: string
    nameTranslit: string
    tagline: string
    edition: string
    subtext: string
  }
  nav: {
    skipToContent: string
    home: string
    store: string
    collections: string
    discoverProducts: string
    switchLanguageLabel: string
    switchLanguageTarget: string
    targetLocale: Locale
  }
  hero: {
    overline: string
    headlineLine1: string
    headlineSpan: string
    intro: string
    exploreButton: string
    collectionsLink: string
    signature1: string
    signature2: string
    artworkLabel: string
    artCaption: string
    tagline: string
    curatedPurpose: string
  }
  qualities: {
    q1Symbol: string
    q1Text: string
    q2Symbol: string
    q2Text: string
    q3Symbol: string
    q3Text: string
  }
  collections: {
    eyebrow: string
    title: string
    titleSpan: string
    intro: string
    waterTitle: string
    waterSub: string
    waterBadge: string
    datesTitle: string
    datesSub: string
    datesBadge: string
    discoverCategory: string
  }
  catalog: {
    kicker: string
    title: string
    description: string
    searchLabel: string
    searchPlaceholder: string
    searchButton: string
    searchSummary: string
    clearSearch: string
    resultCount: (count: number) => string
    noProductsTitle: string
    noProductsQuery: string
    noProductsEmpty: string
    paginationPrev: string
    paginationNext: string
    pageIndicator: (page: number) => string
    allCategories: string
    filterCategory: string
    allProductsLink: string
    featuredTitle: string
    featuredTitleSpan: string
    featuredLink: string
  }
  product: {
    kicker: string
    backToCatalog: string
    breadcrumbsHome: string
    breadcrumbsProducts: string
    noPhoto: string
    selectVariantSingle: string
    selectVariantMultiple: string
    defaultVariant: string
    variantFallback: (index: number) => string
    priceUnavailable: string
    skuLabel: string
    priceNotice: string
    orderNoticeTitle: string
    orderNoticeBody: string
    descriptionTitle: string
    continueShopping: string
    galleryAlt: (title: string, index: number) => string
  }
  footer: {
    eyebrow: string
    headline: string
    headlineSpan: string
    about: string
    quickLinks: string
    home: string
    products: string
    collections: string
    copyright: (year: number) => string
    identity: string
    location: string
  }
  errors: {
    configuration: string
    connection: string
    response: string
    general: string
  }
}

export const dictionaries: Record<Locale, Dictionary> = {
  ar: {
    locale: "ar",
    dir: "rtl",
    brand: {
      name: "زمزم",
      nameTranslit: "زَمْزَمْ سْتُور",
      tagline: "تفاصيل تليق بذوقك",
      edition: "THE EDITION · 01",
      subtext: "ARABIC BY DESIGN",
    },
    nav: {
      skipToContent: "انتقل إلى المحتوى",
      home: "الرئيسية",
      store: "المتجر",
      collections: "المجموعات",
      discoverProducts: "اكتشف المنتجات",
      switchLanguageLabel: "تغيير اللغة إلى الإنجليزية",
      switchLanguageTarget: "English",
      targetLocale: "en",
    },
    hero: {
      overline: "زمزم ستور / ZAMZAM STORE",
      headlineLine1: "في كل تفصيلة،",
      headlineSpan: "حكاية ذوق.",
      intro: "مساحة عربية مختارة لتصفّح مياه زمزم المعبأة والتمور الفاخرة؛ تفاصيل واضحة، وهوية هادئة، ومنتجات تُعرض مباشرة من كتالوج المتجر المعتمد.",
      exploreButton: "اكتشف المجموعة",
      collectionsLink: "تعرّف على الأقسام",
      signature1: "ذوق عربي،",
      signature2: "بتفاصيل معاصرة.",
      artworkLabel: "لوحة طباعية زخرفية تحمل اسم زمزم ستور؛ ليست صورة منتج",
      artCaption: "من الكتالوج",
      tagline: "تصميم للتفاصيل · صنع بالعربية",
      curatedPurpose: "CURATED WITH PURPOSE",
    },
    qualities: {
      q1Symbol: "01",
      q1Text: "تجربة عربية أصيلة من البداية",
      q2Symbol: "02",
      q2Text: "الأسعار الرسمية من نظام المتجر بالجنيه المصري",
      q3Symbol: "03",
      q3Text: "تفاصيل المنتجات كما هي مسجلة في Medusa",
    },
    collections: {
      eyebrow: "الأقسام / ٠١",
      title: "اختيارات، ",
      titleSpan: "لها طابعها.",
      intro: "ابدأ من المجموعة التي تبحث عنها. تظهر المنتجات المعتمدة عند إضافتها ونشرها في الكتالوج.",
      waterTitle: "مياه زمزم",
      waterSub: "عبوات مياه زمزم المباركة المعبأة بمواصفات موثقة.",
      waterBadge: "01 / COLLECTION",
      datesTitle: "التمور الفاخرة",
      datesSub: "أجود أصناف التمور المختارة بعناية.",
      datesBadge: "02 / COLLECTION",
      discoverCategory: "اكتشف ما هو مدرج في الكتالوج",
    },
    catalog: {
      kicker: "الكتالوج",
      title: "اكتشف المنتجات",
      description: "البيانات والأسعار المعروضة تأتي مباشرةً من نظام Medusa بالجنيه المصري.",
      searchLabel: "ابحث في الكتالوج",
      searchPlaceholder: "اسم المنتج أو الصنف...",
      searchButton: "بحث",
      searchSummary: "نتائج البحث عن:",
      clearSearch: "مسح البحث",
      resultCount: (count) => `${count} منتج مطابق`,
      noProductsTitle: "لا توجد منتجات مطابقة",
      noProductsQuery: "جرّب كلمة بحث مختلفة أو اختر قسمًا آخر.",
      noProductsEmpty: "لم تُنشر منتجات على قناة البيع الحالية بعد.",
      paginationPrev: "السابق",
      paginationNext: "التالي",
      pageIndicator: (page) => `الصفحة ${page}`,
      allCategories: "جميع المنتجات",
      filterCategory: "تصفية حسب القسم",
      allProductsLink: "عرض جميع المنتجات",
      featuredTitle: "لأن التفاصيل ",
      featuredTitleSpan: "تصنع الفارق.",
      featuredLink: "عرض جميع المنتجات",
    },
    product: {
      kicker: "تفاصيل المنتج",
      backToCatalog: "العودة للكتالوج",
      breadcrumbsHome: "الرئيسية",
      breadcrumbsProducts: "المنتجات",
      noPhoto: "لا توجد صورة لهذا المنتج حاليًا",
      selectVariantSingle: "العبوة المتاحة في الكتالوج",
      selectVariantMultiple: "اختر العبوة أو الخيار",
      defaultVariant: "الخيار الأساسي",
      variantFallback: (index) => `الخيار ${index + 1}`,
      priceUnavailable: "السعر غير متاح لهذا الخيار",
      skuLabel: "رمز المنتج (SKU)",
      priceNotice: "لا يمكن تأكيد السعر لهذا الخيار من بيانات المتجر.",
      orderNoticeTitle: "معلومات الطلب",
      orderNoticeBody: "تُعرض هنا معلومات الكتالوج الرسمية فقط. ستتاح إمكانية إضافة المنتج إلى السلة والطلب عند اكتمال الربط بالتحقق من المخزون والدفع.",
      descriptionTitle: "الوصف",
      continueShopping: "متابعة التسوق",
      galleryAlt: (title, index) => `${title} — صورة ${index + 1}`,
    },
    footer: {
      eyebrow: "زمزم ستور",
      headline: "تفاصيل تستحق ",
      headlineSpan: "الاهتمام.",
      about: "متجر عربي لاكتشاف مياه زمزم المعبأة والتمور الفاخرة في مصر. جميع تفاصيل المنتجات وأسعارها المعروضة مصدرها نظام المتجر الرسمي.",
      quickLinks: "روابط سريعة",
      home: "الرئيسية",
      products: "المنتجات",
      collections: "المجموعات",
      copyright: (year) => `© ${year} زمزم ستور. جميع الحقوق محفوظة.`,
      identity: "هوية عربية معاصرة",
      location: "ZAMZAM / EGYPT",
    },
    errors: {
      configuration: "لم يتم إعداد اتصال المتجر بالمنتجات بعد. يرجى مراجعة إعدادات الواجهة.",
      connection: "تعذر الاتصال بخدمة المنتجات حاليًا. يرجى المحاولة لاحقًا.",
      response: "تعذر تحميل المنتجات من النظام. يرجى المحاولة لاحقًا.",
      general: "حدث خطأ غير متوقع أثناء معالجة الطلب.",
    },
  },
  en: {
    locale: "en",
    dir: "ltr",
    brand: {
      name: "Zamzam",
      nameTranslit: "ZAMZAM STORE",
      tagline: "Crafted with Heritage and Purpose",
      edition: "THE EDITION · 01",
      subtext: "ARABIC BY DESIGN",
    },
    nav: {
      skipToContent: "Skip to content",
      home: "Home",
      store: "Shop",
      collections: "Collections",
      discoverProducts: "Discover Products",
      switchLanguageLabel: "تغيير اللغة إلى العربية",
      switchLanguageTarget: "العربية",
      targetLocale: "ar",
    },
    hero: {
      overline: "ZAMZAM STORE / CAIRO",
      headlineLine1: "In every detail,",
      headlineSpan: "a taste of heritage.",
      intro: "A refined space to discover authenticated packaged Zamzam water and luxury dates; transparent details, calm aesthetic, sourced directly from the official store catalog.",
      exploreButton: "Explore Collection",
      collectionsLink: "View Collections",
      signature1: "Arabic heritage,",
      signature2: "contemporary craft.",
      artworkLabel: "Decorative typographic emblem for Zamzam Store; brand composition, not product packaging.",
      artCaption: "From Catalog",
      tagline: "Designed for the Details · Crafted in Arabic",
      curatedPurpose: "CURATED WITH PURPOSE",
    },
    qualities: {
      q1Symbol: "01",
      q1Text: "Authentic Arabic-first experience across every touchpoint",
      q2Symbol: "02",
      q2Text: "Authoritative Medusa store prices in Egyptian Pounds (EGP)",
      q3Symbol: "03",
      q3Text: "Verified product attributes and variant SKUs",
    },
    collections: {
      eyebrow: "COLLECTIONS / 01",
      title: "Curated selections, ",
      titleSpan: "defined by quality.",
      intro: "Begin exploring by category. Products appear as soon as they are active and published in the store catalog.",
      waterTitle: "Zamzam Water",
      waterSub: "Blessed Zamzam water packaged in authenticated sizes.",
      waterBadge: "01 / COLLECTION",
      datesTitle: "Luxury Dates",
      datesSub: "Hand-selected premium date cultivars.",
      datesBadge: "02 / COLLECTION",
      discoverCategory: "Explore catalog items",
    },
    catalog: {
      kicker: "CATALOG",
      title: "Discover Products",
      description: "All products, variants, and prices are fetched directly from Medusa in EGP.",
      searchLabel: "Search catalog",
      searchPlaceholder: "Product name or keyword...",
      searchButton: "Search",
      searchSummary: "Search results for:",
      clearSearch: "Clear search",
      resultCount: (count) => `${count} matching ${count === 1 ? "product" : "products"}`,
      noProductsTitle: "No matching products found",
      noProductsQuery: "Try a different search query or select another category.",
      noProductsEmpty: "No products are currently published for this sales channel.",
      paginationPrev: "Previous",
      paginationNext: "Next",
      pageIndicator: (page) => `Page ${page}`,
      allCategories: "All Products",
      filterCategory: "Filter by category",
      allProductsLink: "View all products",
      featuredTitle: "Because the details ",
      featuredTitleSpan: "make the difference.",
      featuredLink: "View all products",
    },
    product: {
      kicker: "PRODUCT DETAILS",
      backToCatalog: "Back to catalog",
      breadcrumbsHome: "Home",
      breadcrumbsProducts: "Products",
      noPhoto: "No image currently available for this product",
      selectVariantSingle: "Available package option",
      selectVariantMultiple: "Select package size or option",
      defaultVariant: "Standard Option",
      variantFallback: (index) => `Option ${index + 1}`,
      priceUnavailable: "Price unavailable for this option",
      skuLabel: "Product SKU",
      priceNotice: "Price could not be confirmed from store records for this variant.",
      orderNoticeTitle: "Ordering Information",
      orderNoticeBody: "This is a catalog preview only. Adding to cart and checkout will be enabled once batch inventory reservation and payment integrations are finalized.",
      descriptionTitle: "Description",
      continueShopping: "Continue Shopping",
      galleryAlt: (title, index) => `${title} — Image ${index + 1}`,
    },
    footer: {
      eyebrow: "ZAMZAM STORE",
      headline: "Details worthy of ",
      headlineSpan: "your attention.",
      about: "A refined Arabic e-commerce storefront for packaged Zamzam water and luxury dates in Egypt. All product information and prices originate from the official store system.",
      quickLinks: "Quick Links",
      home: "Home",
      products: "Products",
      collections: "Collections",
      copyright: (year) => `© ${year} Zamzam Store. All rights reserved.`,
      identity: "Contemporary Arabic Identity",
      location: "ZAMZAM / EGYPT",
    },
    errors: {
      configuration: "Store connection is not configured yet. Please check storefront environment variables.",
      connection: "Unable to connect to the catalog service at this time. Please try again later.",
      response: "Unable to load product data from the store system. Please try again later.",
      general: "An unexpected error occurred while processing the catalog request.",
    },
  },
}

export function getDictionary(locale: Locale = "ar"): Dictionary {
  return dictionaries[locale] ?? dictionaries.ar
}


export function getEquivalentPath(pathname: string, targetLocale: Locale): string {
  const cleanPath = pathname.split("?")[0] || "/"
  const query = pathname.includes("?") ? `?${pathname.split("?")[1]}` : ""

  if (targetLocale === "en") {
    if (cleanPath.startsWith("/en")) return `${cleanPath}${query}`
    const enPath = cleanPath === "/" ? "/en" : `/en${cleanPath}`
    return `${enPath}${query}`
  } else {
    // Target is Arabic (root /)
    if (!cleanPath.startsWith("/en")) return `${cleanPath}${query}`
    const stripped = cleanPath.replace(/^\/en/, "")
    const arPath = stripped === "" ? "/" : stripped
    return `${arPath}${query}`
  }
}

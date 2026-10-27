/**
 * Locale routing and UI copy for the storefront.
 *
 * Arabic is the unprefixed default (`/`, `/products`), English is prefixed
 * (`/en`, `/en/products`). Catalog content is never machine-translated: product
 * titles, descriptions and prices are rendered exactly as they come from Medusa.
 */
export const locales = ["ar", "en"] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "ar"

export const localeDirection: Record<Locale, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" }
export const localeLabel: Record<Locale, string> = { ar: "العربية", en: "English" }

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "ar" || value === "en"
}

export function alternateLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar"
}

/** Public URL for a locale-independent path. */
export function localePath(locale: Locale, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (locale === "ar") return normalized
  return normalized === "/" ? "/en" : `/en${normalized}`
}

/** Remove a leading locale prefix so a path can be rebuilt for another locale. */
export function stripLocale(pathname: string): string {
  if (pathname === "/en" || pathname === "/ar") return "/"
  if (pathname.startsWith("/en/")) return pathname.slice(3)
  if (pathname.startsWith("/ar/")) return pathname.slice(3)
  return pathname || "/"
}

export function buildLanguageSwitchHref(
  currentLocale: Locale,
  pathname: string,
  search?: string | URLSearchParams | null
): string {
  const targetLocale = alternateLocale(currentLocale)
  const cleanPath = stripLocale(pathname)
  const targetPath = localePath(targetLocale, cleanPath)

  let queryString = ""
  if (typeof search === "string" && search.trim()) {
    const trimmed = search.trim()
    queryString = trimmed.startsWith("?") ? trimmed : `?${trimmed}`
  } else if (search instanceof URLSearchParams) {
    const str = search.toString()
    queryString = str ? `?${str}` : ""
  }

  return `${targetPath}${queryString}`
}

export function localeFromPathname(pathname: string): Locale {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "ar"
}

const numberLocales: Record<Locale, string> = { ar: "ar-EG", en: "en-EG" }

/** Grouped digits in the reader's own numeral system. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocales[locale] ?? numberLocales.ar).format(value)
}

export type Dictionary = {
  meta: { title: string; description: string }
  a11y: { skip: string }
  brand: { homeLabel: string; name: string; sub: string }
  topbar: { welcome: string; tagline: string }
  nav: { label: string; home: string; shop: string; collections: string; discover: string }
  language: { label: string; switchTo: string }
  footer: {
    eyebrow: string
    titleLead: string
    titleAccent: string
    body: string
    linksLabel: string
    home: string
    products: string
    collections: string
    rights: (year: number) => string
    identity: string
  }
  home: {
    overline: string
    overlineEn: string
    titleLead: string
    titleAccent: string
    intro: string
    primaryCta: string
    secondaryCta: string
    signature: string
    artLabel: string
    captionLabel: string
    footStart: string
    footEnd: string
    qualities: [string, string, string]
    collectionsEyebrow: string
    collectionsTitle: string
    collectionsAccent: string
    collectionsIntro: string
    collectionWord: string
    collectionOrdinals: [string, string, string, string]
    collectionCta: string
    collectionsEmptyTitle: string
    collectionsEmptyBody: string
    featuredEyebrow: string
    featuredTitle: string
    featuredAccent: string
    viewAll: string
    stateErrorEyebrow: string
    stateErrorTitle: string
    stateOpenCatalog: string
    stateEmptyEyebrow: string
    stateEmptyTitle: string
    stateEmptyBody: string
    finaleEyebrow: string
    finaleTitle: string
    finaleAccent: string
    finaleBody: string
    finaleCta: string
  }
  catalog: {
    breadcrumbHome: string
    breadcrumb: string
    kicker: string
    title: string
    intro: string
    searchLabel: string
    searchPlaceholder: string
    searchButton: string
    resultsFor: string
    clearSearch: string
    resultCount: (count: string) => string
    pageLabel: (page: string, total: string) => string
    prev: string
    next: string
    categoryFilterLabel: string
    allCategories: string
    emptyTitle: string
    emptyQuery: string
    emptyCatalog: string
    errorTitle: string
  }
  product: {
    kicker: string
    detailsCta: string
    descriptionHeading: string
    orderInfoTitle: string
    orderInfoBody: string
    stockNote: string
    continueShopping: string
    backToCatalog: string
    noImage: string
    galleryLabel: string
    priceUnavailable: string
    variantLabelSingle: string
    variantLabelMultiple: string
    variantFallback: (index: number) => string
    variantPrimary: string
    skuLabel: string
    variantPriceUnavailable: string
    variantWarning: string
    variantNotice: string
    metaTitleFallback: string
    metaDescriptionFallback: string
  }
  errors: { configuration: string; connection: string; response: string }
  notFound: { title: string; body: string; cta: string }
  availability: {
    heading: string
    available: { label: string; description: string }
    unavailable: { label: string; description: string }
    unknown: { label: string; description: string }
    disclaimer: string
  }
  cart: {
    title: string
    emptyTitle: string
    emptyMessage: string
    continueShopping: string
    itemHeader: string
    quantityHeader: string
    priceHeader: string
    subtotalHeader: string
    totalHeader: string
    itemsCount: (count: number) => string
    authoritativeNotice: string
    nonProductionNotice: string
    variantLabel: string
    unitPriceLabel: string
    subtotalLabel: string
    totalLabel: string
    currency: string
    errorTitle: string
    lockedError: string
    completedError: string
    timeoutError: string
    genericError: string
    previewBadge: string
    addToCartButton: string
    addingToCart: string
    addedSuccess: string
    disabledNotice: string
    checkoutDisabledNotice: string
    goToCheckout: string
  }
  checkout: {
    title: string
    subtitle: string
    backToCart: string
    guestInfoHeading: string
    orderSummaryHeading: string
    fullNameLabel: string
    fullNamePlaceholder: string
    phoneLabel: string
    phonePlaceholder: string
    governorateLabel: string
    selectGovernorate: string
    cityLabel: string
    cityPlaceholder: string
    addressLabel: string
    addressPlaceholder: string
    notesLabel: string
    notesPlaceholder: string
    nameRequired: string
    phoneRequired: string
    governorateRequired: string
    cityRequired: string
    addressRequired: string
    shippingHeader: string
    shippingPending: string
    shippingNotice: string
    payableTotalNotice: string
    itemsSubtotal: string
    disabledNotice: string
    qaBadge: string
    previewBadge: string
    qaSimulateButton: string
    disabledSubmitButton: string
    qaSuccessTitle: string
    qaSuccessNotice: string
    emptyCartNotice: string
    backToShop: string
  }
}

const ar: Dictionary = {
  meta: {
    title: "زمزم ستور | تفاصيل تليق بذوقك",
    description:
      "زمزم ستور: تجربة عربية راقية لتصفح مياه زمزم المعبأة والتمور، مع بيانات وأسعار من كتالوج Medusa.",
  },
  a11y: { skip: "انتقل إلى المحتوى" },
  brand: { homeLabel: "زمزم ستور — الرئيسية", name: "زمزم", sub: "زَمْزَمْ سْتُور" },
  topbar: { welcome: "أهلًا بك في زمزم ستور", tagline: "ARABIC BY DESIGN ✦ ZAMZAM STORE" },
  nav: {
    label: "التنقل الرئيسي",
    home: "الرئيسية",
    shop: "المتجر",
    collections: "المجموعات",
    discover: "اكتشف المنتجات",
  },
  language: { label: "اللغة", switchTo: "عرض الموقع بالإنجليزية" },
  footer: {
    eyebrow: "زمزم ستور",
    titleLead: "تفاصيل تستحق",
    titleAccent: "الاهتمام.",
    body: "متجر عربي لاكتشاف مياه زمزم المعبأة والتمور. جميع تفاصيل المنتجات وأسعارها المعروضة مصدرها نظام المتجر.",
    linksLabel: "روابط سريعة",
    home: "الرئيسية",
    products: "المنتجات",
    collections: "المجموعات",
    rights: (year) => `© ${year} زمزم ستور`,
    identity: "هوية عربية معاصرة",
  },
  home: {
    overline: "زمزم ستور",
    overlineEn: "ZAMZAM / COLLECTIONS",
    titleLead: "في كل تفصيلة،",
    titleAccent: "حكاية ذوق.",
    intro:
      "مساحة عربية مختارة لتصفّح مياه زمزم المعبأة والتمور؛ تفاصيل واضحة، وهوية هادئة، ومنتجات تُعرض مباشرة من كتالوج المتجر.",
    primaryCta: "اكتشف المجموعة",
    secondaryCta: "تعرّف على الأقسام",
    signature: "ذوق عربي،\nبتفاصيل معاصرة.",
    artLabel: "لوحة طباعية زخرفية تحمل اسم زمزم ستور؛ ليست صورة منتج",
    captionLabel: "من الكتالوج",
    footStart: "تصفّح بثقة في مصدر البيانات",
    footEnd: "تصميم للتفاصيل · صنع بالعربية",
    qualities: ["تجربة عربية من البداية", "الأسعار من نظام المتجر", "تفاصيل المنتجات كما هي مسجلة"],
    collectionsEyebrow: "الأقسام / ٠١",
    collectionsTitle: "اختيارات،",
    collectionsAccent: "لها طابعها.",
    collectionsIntro:
      "ابدأ من المجموعة التي تبحث عنها. تظهر المنتجات عند إضافتها ونشرها في الكتالوج.",
    collectionWord: "COLLECTION",
    collectionOrdinals: ["المجموعة الأولى", "المجموعة الثانية", "المجموعة الثالثة", "المجموعة الرابعة"],
    collectionCta: "اكتشف ما هو مدرج في الكتالوج",
    collectionsEmptyTitle: "لم تُنشر أقسام بعد.",
    collectionsEmptyBody:
      "تظهر الأقسام الحقيقية هنا تلقائيًا بمجرد إنشائها في Medusa. لا نعرض أقسامًا افتراضية.",
    featuredEyebrow: "من الكتالوج / ٠٢",
    featuredTitle: "لأن التفاصيل",
    featuredAccent: "تصنع الفارق.",
    viewAll: "عرض جميع المنتجات",
    stateErrorEyebrow: "إعداد الكتالوج",
    stateErrorTitle: "المنتجات غير متاحة للعرض الآن.",
    stateOpenCatalog: "افتح صفحة الكتالوج",
    stateEmptyEyebrow: "المنتجات",
    stateEmptyTitle: "أول مجموعة لم تُنشر بعد.",
    stateEmptyBody:
      "تظهر المنتجات الحقيقية هنا تلقائيًا بمجرد نشرها في Medusa. لا نعرض صورًا أو أسعارًا افتراضية.",
    finaleEyebrow: "زمزم ستور / التفاصيل أولًا",
    finaleTitle: "اختيارك يبدأ",
    finaleAccent: "من هنا.",
    finaleBody:
      "صفحات منتجات واضحة، وتجربة عربية تُظهر ما يقدّمه الكتالوج بالفعل دون وعود غير مؤكدة.",
    finaleCta: "ابدأ التصفح",
  },
  catalog: {
    breadcrumbHome: "الرئيسية",
    breadcrumb: "المنتجات",
    kicker: "الكتالوج",
    title: "اكتشف المنتجات",
    intro: "البيانات المعروضة تأتي مباشرةً من قائمة المنتجات المنشورة في Medusa.",
    searchLabel: "ابحث عن منتج",
    searchPlaceholder: "اسم المنتج...",
    searchButton: "بحث",
    resultsFor: "نتائج البحث عن:",
    clearSearch: "مسح البحث",
    resultCount: (count) => `${count} منتج مطابق`,
    pageLabel: (page, total) => `الصفحة ${page} من ${total}`,
    prev: "السابق",
    next: "التالي",
    categoryFilterLabel: "تصفية حسب القسم",
    allCategories: "كل المنتجات",
    emptyTitle: "لا توجد منتجات مطابقة",
    emptyQuery: "جرّب كلمة بحث مختلفة أو أزل تصفية القسم.",
    emptyCatalog: "لم تُنشر منتجات على قناة البيع الحالية بعد.",
    errorTitle: "تعذر تحميل المنتجات",
  },
  product: {
    kicker: "تفاصيل المنتج",
    detailsCta: "التفاصيل",
    descriptionHeading: "الوصف",
    orderInfoTitle: "معلومات الطلب",
    orderInfoBody:
      "تُعرض هنا معلومات الكتالوج فقط. ستتاح إمكانية إضافة المنتج إلى السلة عند اكتمال الربط بالتحقق من المخزون والدفع.",
    stockNote: "لا نعرض حالة المخزون هنا؛ تُؤكَّد الإتاحة عند إتمام الطلب من نظام المتجر.",
    continueShopping: "متابعة التسوق",
    backToCatalog: "العودة للكتالوج",
    noImage: "لا توجد صورة لهذا المنتج حاليًا",
    galleryLabel: "صور المنتج",
    priceUnavailable: "السعر غير متاح حاليًا",
    variantLabelSingle: "العبوة المتاحة في الكتالوج",
    variantLabelMultiple: "اختر العبوة أو الخيار",
    variantFallback: (index) => `الخيار ${index}`,
    variantPrimary: "الخيار الأساسي",
    skuLabel: "رمز المنتج (SKU):",
    variantPriceUnavailable: "السعر غير متاح لهذا الخيار",
    variantWarning: "لا يمكن تأكيد السعر لهذا الخيار من بيانات المتجر.",
    variantNotice: "هذه معلومات للعرض فقط؛ إتاحة الشراء تعتمد على التحقق من المخزون والدفع لاحقًا.",
    metaTitleFallback: "تفاصيل المنتج | زمزم ستور",
    metaDescriptionFallback: "تفاصيل المنتج في زمزم ستور",
  },
  errors: {
    configuration:
      "لم يتم إعداد اتصال المتجر بالمنتجات بعد. أضف رابط Medusa ومفتاح النشر إلى إعدادات الواجهة.",
    connection: "تعذر الاتصال بخدمة المنتجات حاليًا. يرجى المحاولة لاحقًا.",
    response: "تعذر تحميل المنتجات من النظام. يرجى المحاولة لاحقًا.",
  },
  notFound: {
    title: "الصفحة غير موجودة",
    body: "لم نعثر على الصفحة التي تبحث عنها. قد يكون الرابط قديمًا أو أن المنتج لم يُنشر بعد.",
    cta: "العودة للرئيسية",
  },
  availability: {
    heading: "حالة التوفر",
    available: {
      label: "متوفر في المخزون المعتمد",
      description: "الصنف متاح حاليًا وفق فحص الدُفعات المعتمد.",
    },
    unavailable: {
      label: "غير متوفر حاليًا",
      description: "هذا الخيار غير متاح للتسليم الفوري حاليًا.",
    },
    unknown: {
      label: "قيد التحقق عند فتح الطلب",
      description: "تُؤكَّد إتاحة الصنف من سجل الدُفعات الفعلي عند إتمام الطلب.",
    },
    disclaimer:
      "لا نقدّم وعودًا مسبقة بالتوفر؛ يتم فحص الدُفعات وتاريخ الصلاحية الفعلي عبر نظام المتجر.",
  },
  cart: {
    title: "سلة المشتريات",
    emptyTitle: "سلتك فارغة حاليًا",
    emptyMessage: "لم تُضف أي منتجات بعد. تصفح تشكيلتنا من ماء زمزم والتمور الفاخرة.",
    continueShopping: "متابعة التسوق",
    itemHeader: "المنتج",
    quantityHeader: "الكمية",
    priceHeader: "السعر",
    subtotalHeader: "المجموع الفرعي",
    totalHeader: "الإجمالي المعتمد",
    itemsCount: (count: number) => `${count} أصناف`,
    authoritativeNotice:
      "يتم احتساب الإجمالي والأسعار حصرًا عبر نظام المتجر المركزي ولا يتم احتسابها من الواجهة.",
    nonProductionNotice:
      "هذه الواجهة مخصصة للعرض والمعاينة الفنية ولا تُمثل طلبًا تجاريًا حقيقيًا.",
    variantLabel: "الخيار",
    unitPriceLabel: "سعر الوحدة",
    subtotalLabel: "المجموع",
    totalLabel: "الإجمالي النهائي",
    currency: "ج.م",
    errorTitle: "تعذر تحديث السلة",
    lockedError: "عملية الدفع قيد المعالجة حاليًا؛ لا يمكن تعديل السلة.",
    completedError: "تم تحويل هذه السلة إلى طلب مسبقًا.",
    timeoutError: "انتهت مهلة قفل السلة. يرجى المحاولة لاحقًا.",
    genericError: "حدث خطأ أثناء معالجة السلة.",
    previewBadge: "معاينة تجريبية",
    addToCartButton: "إضافة إلى السلة (معاينة)",
    addingToCart: "جاري الإضافة...",
    addedSuccess: "تمت الإضافة إلى السلة بنجاح",
    disabledNotice: "خاصية الشراء غير مفعّلة في الإصدار الحالي.",
    checkoutDisabledNotice: "إتمام الطلب والدفع غير مفعلين في هذه المرحلة.",
    goToCheckout: "متابعة بيانات التوصيل (معاينة)",
  },
  checkout: {
    title: "بيانات إتمام الطلب",
    subtitle: "بيانات العميل وعنوان التوصيل",
    backToCart: "العودة إلى سلة المشتريات",
    guestInfoHeading: "بيانات التوصيل للعميل",
    orderSummaryHeading: "ملخص الطلب المعتمد",
    fullNameLabel: "الاسم بالكامل",
    fullNamePlaceholder: "الاسم الثلاثي أو الثنائي",
    phoneLabel: "رقم الهاتف المحمول (مصر)",
    phonePlaceholder: "مثال: 01012345678",
    governorateLabel: "المحافظة",
    selectGovernorate: "اختر المحافظة",
    cityLabel: "المدينة / الحي",
    cityPlaceholder: "مثال: مدينة نصر، المعادي، الدقي...",
    addressLabel: "العنوان التفصيلي",
    addressPlaceholder: "اسم الشارع، رقم المبنى، رقم الشقة أو الطابق",
    notesLabel: "ملاحظات التوصيل (اختياري)",
    notesPlaceholder: "علامة مميزة أو إرشادات خاصة بالتسليم",
    nameRequired: "يرجى إدخال الاسم بالكامل (3 أحرف على الأقل).",
    phoneRequired: "يرجى إدخال رقم هاتف محمول مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015).",
    governorateRequired: "يرجى اختيار المحافظة.",
    cityRequired: "يرجى إدخال المدينة أو الحي.",
    addressRequired: "يرجى إدخال العنوان التفصيلي (5 أحرف على الأقل).",
    shippingHeader: "رسوم التوصيل",
    shippingPending: "يتم تحديدها لاحقًا من قِبل المتجر",
    shippingNotice:
      "لا يتم احتساب أو تخمين رسوم التوصيل من الواجهة؛ سيتم تحديدها واعتمادها عبر نظام المتجر عند تأكيد الطلب.",
    payableTotalNotice: "الإجمالي النهائي المستحق يُحدد بعد اعتماد رسوم التوصيل.",
    itemsSubtotal: "المجموع المعتمد للمنتجات",
    disabledNotice: "خاصية إتمام الطلبات والدفع معطّلة حاليًا في هذه النسخة التجريبية.",
    qaBadge: "معاينة ضبط الجودة (QA)",
    previewBadge: "معاينة تجريبية",
    qaSimulateButton: "التحقق من بيانات التوصيل (محاكاة QA)",
    disabledSubmitButton: "إتمام الطلب معطّل حاليًا",
    qaSuccessTitle: "تم التحقق من بيانات التوصيل بنجاح (محاكاة QA)",
    qaSuccessNotice:
      "هذه محاكاة تدقيق فني فقط. إتمام الطلبات الفعلي، وتحديد رسوم الشحن، ومعالجة الدفع معطّلة بالكامل حتى اعتماد مسار الدفع المركزي.",
    emptyCartNotice: "سلة المشتريات فارغة. يرجى إضافة منتجات أولاً قبل متابعة التوصيل.",
    backToShop: "تصفح المنتجات",
  },
}

const en: Dictionary = {
  meta: {
    title: "Zamzam Store | Details worth your attention",
    description:
      "Zamzam Store: a refined bilingual storefront for bottled Zamzam water and dates, with product data and prices read directly from the Medusa catalog.",
  },
  a11y: { skip: "Skip to content" },
  brand: { homeLabel: "Zamzam Store — home", name: "Zamzam", sub: "ZAMZAM STORE" },
  topbar: { welcome: "Welcome to Zamzam Store", tagline: "ARABIC BY DESIGN ✦ ZAMZAM STORE" },
  nav: {
    label: "Main navigation",
    home: "Home",
    shop: "Shop",
    collections: "Collections",
    discover: "Browse products",
  },
  language: { label: "Language", switchTo: "View the site in Arabic" },
  footer: {
    eyebrow: "Zamzam Store",
    titleLead: "Details worth",
    titleAccent: "your attention.",
    body: "An Arabic-first storefront for browsing bottled Zamzam water and dates. Every product detail and price shown here comes from the store system.",
    linksLabel: "Quick links",
    home: "Home",
    products: "Products",
    collections: "Collections",
    rights: (year) => `© ${year} Zamzam Store`,
    identity: "A contemporary Arabic identity",
  },
  home: {
    overline: "Zamzam Store",
    overlineEn: "ZAMZAM / COLLECTIONS",
    titleLead: "In every detail,",
    titleAccent: "a story of taste.",
    intro:
      "A curated Arabic space for browsing bottled Zamzam water and dates: clear details, a quiet identity, and products shown directly from the store catalog.",
    primaryCta: "Discover the collection",
    secondaryCta: "Explore the collections",
    signature: "Arabic taste,\ncontemporary detail.",
    artLabel: "A decorative typographic panel carrying the Zamzam Store name; not a product photograph",
    captionLabel: "From the catalog",
    footStart: "Browse with confidence in the source",
    footEnd: "Designed for the details · made in Arabic",
    qualities: ["Arabic-first experience", "Prices from the store system", "Product details as recorded"],
    collectionsEyebrow: "Collections / 01",
    collectionsTitle: "Curated,",
    collectionsAccent: "each with its character.",
    collectionsIntro:
      "Start from the collection you are looking for. Products appear once they are added and published in the catalog.",
    collectionWord: "COLLECTION",
    collectionOrdinals: ["Collection one", "Collection two", "Collection three", "Collection four"],
    collectionCta: "Discover what is listed in the catalog",
    collectionsEmptyTitle: "No collections published yet.",
    collectionsEmptyBody:
      "Real collections appear here automatically once they are created in Medusa. We do not invent placeholder collections.",
    featuredEyebrow: "From the catalog / 02",
    featuredTitle: "Because details",
    featuredAccent: "make the difference.",
    viewAll: "View all products",
    stateErrorEyebrow: "Catalog setup",
    stateErrorTitle: "Products are not available to display right now.",
    stateOpenCatalog: "Open the catalog page",
    stateEmptyEyebrow: "Products",
    stateEmptyTitle: "The first collection is not published yet.",
    stateEmptyBody:
      "Real products appear here automatically once published in Medusa. We never show placeholder images or prices.",
    finaleEyebrow: "Zamzam Store / details first",
    finaleTitle: "Your choice starts",
    finaleAccent: "here.",
    finaleBody:
      "Clear product pages and an Arabic-first experience that reflects what the catalog already offers, without unverified promises.",
    finaleCta: "Start browsing",
  },
  catalog: {
    breadcrumbHome: "Home",
    breadcrumb: "Products",
    kicker: "Catalog",
    title: "Discover products",
    intro: "Everything shown here comes directly from the published product list in Medusa.",
    searchLabel: "Search for a product",
    searchPlaceholder: "Product name...",
    searchButton: "Search",
    resultsFor: "Search results for:",
    clearSearch: "Clear search",
    resultCount: (count) => `${count} matching products`,
    pageLabel: (page, total) => `Page ${page} of ${total}`,
    prev: "Previous",
    next: "Next",
    categoryFilterLabel: "Filter by collection",
    allCategories: "All products",
    emptyTitle: "No matching products",
    emptyQuery: "Try a different search term or remove the collection filter.",
    emptyCatalog: "No products have been published to the current sales channel yet.",
    errorTitle: "Unable to load products",
  },
  product: {
    kicker: "Product details",
    detailsCta: "Details",
    descriptionHeading: "Description",
    orderInfoTitle: "Order information",
    orderInfoBody:
      "This page shows catalog information only. Adding the product to the cart becomes available once inventory verification and payment integration are complete.",
    stockNote: "Stock status is not shown here; availability is confirmed when an order is placed in the store system.",
    continueShopping: "Continue shopping",
    backToCatalog: "Back to the catalog",
    noImage: "No image is available for this product yet",
    galleryLabel: "Product images",
    priceUnavailable: "Price is not available right now",
    variantLabelSingle: "Package available in the catalog",
    variantLabelMultiple: "Choose the package or option",
    variantFallback: (index) => `Option ${index}`,
    variantPrimary: "Default option",
    skuLabel: "SKU:",
    variantPriceUnavailable: "Price is not available for this option",
    variantWarning: "This option's price cannot be confirmed from the store data.",
    variantNotice: "This information is for display only; purchasing depends on inventory verification and payment at a later stage.",
    metaTitleFallback: "Product details | Zamzam Store",
    metaDescriptionFallback: "Product details at Zamzam Store",
  },
  errors: {
    configuration:
      "The store connection is not configured yet. Add the Medusa URL and publishable key to the storefront settings.",
    connection: "The product service could not be reached right now. Please try again later.",
    response: "Products could not be loaded from the system. Please try again later.",
  },
  notFound: {
    title: "Page not found",
    body: "We could not find the page you are looking for. The link may be outdated or the product may not be published yet.",
    cta: "Back to home",
  },
  availability: {
    heading: "Availability",
    available: {
      label: "In Verified Stock",
      description: "Currently available based on verified batch inventory inspection.",
    },
    unavailable: {
      label: "Currently Unavailable",
      description: "This option is currently out of stock for immediate delivery.",
    },
    unknown: {
      label: "Confirmed Upon Order",
      description: "Batch availability is confirmed against store inventory records when ordering.",
    },
    disclaimer:
      "We do not make advance stock guarantees; actual batch eligibility and shelf life are verified via the store system.",
  },
  cart: {
    title: "Shopping Cart",
    emptyTitle: "Your cart is currently empty",
    emptyMessage: "You haven't added any products yet. Explore our curated Zamzam water and fine dates.",
    continueShopping: "Continue Shopping",
    itemHeader: "Product",
    quantityHeader: "Quantity",
    priceHeader: "Unit Price",
    subtotalHeader: "Subtotal",
    totalHeader: "Authoritative Total",
    itemsCount: (count: number) => `${count} item(s)`,
    authoritativeNotice:
      "Totals and line amounts are calculated exclusively by the store system, never by the browser.",
    nonProductionNotice:
      "This cart interface is a technical nonproduction preview and does not constitute a real commercial order.",
    variantLabel: "Variant",
    unitPriceLabel: "Unit price",
    subtotalLabel: "Subtotal",
    totalLabel: "Grand total",
    currency: "EGP",
    errorTitle: "Cart update error",
    lockedError: "Cart checkout currently in progress; mutations locked.",
    completedError: "This cart has already been converted to an order.",
    timeoutError: "Cart lock timed out. Please try again later.",
    genericError: "An error occurred while processing the cart.",
    previewBadge: "Nonproduction Preview",
    addToCartButton: "Add to Cart (Preview)",
    addingToCart: "Adding...",
    addedSuccess: "Successfully added to cart",
    disabledNotice: "Purchasing actions are disabled in this release.",
    checkoutDisabledNotice: "Checkout and payment are not active in this stage.",
    goToCheckout: "Proceed to Delivery Details (Preview)",
  },
  checkout: {
    title: "Guest Checkout",
    subtitle: "Customer Details & Delivery Address",
    backToCart: "Back to Shopping Cart",
    guestInfoHeading: "Delivery Information",
    orderSummaryHeading: "Authoritative Order Summary",
    fullNameLabel: "Full Name",
    fullNamePlaceholder: "First and last name",
    phoneLabel: "Mobile Number (Egypt)",
    phonePlaceholder: "e.g. 01012345678",
    governorateLabel: "Governorate",
    selectGovernorate: "Select Governorate",
    cityLabel: "City / District",
    cityPlaceholder: "e.g. Nasr City, Dokki, Maadi...",
    addressLabel: "Detailed Address",
    addressPlaceholder: "Street, building number, apartment/floor",
    notesLabel: "Delivery Notes (Optional)",
    notesPlaceholder: "Landmarks or specific delivery instructions",
    nameRequired: "Please enter your full name (at least 3 characters).",
    phoneRequired: "Please enter a valid Egyptian mobile number (11 digits starting with 010, 011, 012, or 015).",
    governorateRequired: "Please select a governorate.",
    cityRequired: "Please enter your city or district.",
    addressRequired: "Please enter detailed delivery address (at least 5 characters).",
    shippingHeader: "Delivery Fee",
    shippingPending: "Pending store confirmation",
    shippingNotice:
      "Delivery fees are never calculated or estimated by the browser; they will be confirmed via the store system.",
    payableTotalNotice: "Final payable total is confirmed upon shipping quote.",
    itemsSubtotal: "Items Authoritative Subtotal",
    disabledNotice: "Order placement and payment collection are disabled in this preview release.",
    qaBadge: "QA Simulation Mode",
    previewBadge: "Nonproduction Preview",
    qaSimulateButton: "Validate Delivery Details (QA Simulation)",
    disabledSubmitButton: "Checkout Disabled",
    qaSuccessTitle: "Delivery Details Validated (QA Simulation)",
    qaSuccessNotice:
      "This is a technical validation preview only. Real order creation, live shipping quotes, and payment gateways remain locked until central store authorization.",
    emptyCartNotice: "Your cart is currently empty. Please add items before proceeding to checkout.",
    backToShop: "Browse Products",
  },
}

export const dictionaries: Record<Locale, Dictionary> = { ar, en }

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[defaultLocale]
}

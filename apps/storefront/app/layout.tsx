import type { Metadata } from "next"
import Link from "next/link"
import "./globals.css"

export const metadata: Metadata = {
  title: "زمزم ستور | تفاصيل تليق بذوقك",
  description: "زمزم ستور: تجربة عربية راقية لتصفح مياه زمزم المعبأة والتمور، مع بيانات وأسعار من كتالوج Medusa.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <a className="lux-skip-link" href="#main-content">انتقل إلى المحتوى</a>
        <div className="lux-topbar">
          <div className="shell lux-topbar-content">
            <span>أهلًا بك في زمزم ستور</span>
            <span className="lux-topbar-en">ARABIC BY DESIGN <span aria-hidden="true">✦</span> ZAMZAM STORE</span>
          </div>
        </div>
        <header className="lux-header">
          <div className="shell lux-nav">
            <Link href="/" className="lux-brand" aria-label="زمزم ستور — الرئيسية">
              <span className="lux-brand-mark" aria-hidden="true">ز</span>
              <span className="lux-brand-name">زمزم <small>زَمْزَمْ سْتُور</small></span>
            </Link>
            <nav className="lux-primary-nav" aria-label="التنقل الرئيسي">
              <Link href="/">الرئيسية</Link>
              <Link href="/products">المتجر</Link>
              <Link href="/#lux-collections">المجموعات</Link>
            </nav>
            <Link className="lux-header-action" href="/products">
              اكتشف المنتجات
              <span aria-hidden="true">↖</span>
            </Link>
          </div>
        </header>
        {children}
        <footer className="lux-footer">
          <div className="shell">
            <div className="lux-footer-grid">
              <div className="lux-footer-about">
                <span className="lux-eyebrow">زمزم ستور</span>
                <strong>تفاصيل تستحق<br /><span>الاهتمام.</span></strong>
                <p>متجر عربي لاكتشاف مياه زمزم المعبأة والتمور. جميع تفاصيل المنتجات وأسعارها المعروضة مصدرها نظام المتجر.</p>
              </div>
              <nav className="lux-footer-links" aria-label="روابط المتجر">
                <span>روابط سريعة</span>
                <Link href="/">الرئيسية <span aria-hidden="true">↗</span></Link>
                <Link href="/products">المنتجات <span aria-hidden="true">↗</span></Link>
                <Link href="/#lux-collections">المجموعات <span aria-hidden="true">↗</span></Link>
              </nav>
              <div className="lux-footer-mark" aria-hidden="true">ز</div>
            </div>
            <div className="lux-footer-bottom">
              <span>© {new Date().getFullYear()} زمزم ستور</span>
              <span>هوية عربية معاصرة</span>
              <span className="lux-footer-en">ZAMZAM / EGYPT</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}

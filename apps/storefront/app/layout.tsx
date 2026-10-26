import type { Metadata } from "next"
import Link from "next/link"
import "./globals.css"

export const metadata: Metadata = {
  title: "زمزم ستور | حكاية التفاصيل",
  description: "تصفح كتالوج زمزم ستور من مياه زمزم المعبأة والتمور في تجربة عربية. بيانات المنتجات من Medusa."
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>
        <div className="atelier-announcement"><div className="shell announcement-inner">
          <span>✳ <span className="announcement-desktop">رحلة من التفاصيل، تبدأ هنا</span><span className="announcement-mobile">مرحبًا بك في زمزم ستور</span></span>
          <span className="announcement-english">ZAMZAM / ONLINE EDITION</span>
        </div></div>
        <header className="atelier-header">
          <div className="shell atelier-nav">
            <Link href="/" className="atelier-brand" aria-label="زمزم ستور — الرئيسية">
              <span className="atelier-brand-symbol" aria-hidden="true">ز</span>
              <span className="atelier-brand-word">زمزم <small>STORE <span>✳</span></small></span>
            </Link>
            <nav className="atelier-nav-links" aria-label="التنقل الرئيسي">
              <Link href="/">الرئيسية</Link>
              <Link href="/products">المنتجات</Link>
              <Link href="/#collections">المجموعات</Link>
            </nav>
            <Link href="/products" className="atelier-nav-action"><span>اكتشف الكتالوج</span><span aria-hidden="true">↗</span></Link>
          </div>
        </header>
        {children}
        <footer className="atelier-footer">
          <div className="shell">
            <div className="atelier-footer-top">
              <div className="atelier-footer-brand">
                <span className="footer-eyebrow">من التفاصيل تتكوّن الحكاية.</span>
                <strong>زمزم<span>✳</span></strong>
                <p>واجهة عربية لاكتشاف المنتجات المنشورة وأسعارها الفعلية، مع وضوح ما هو متاح وما لم يُفعّل بعد.</p>
              </div>
              <div className="atelier-footer-navigation">
                <span className="footer-label">تصفّح</span>
                <Link href="/">الرئيسية <span aria-hidden="true">↗</span></Link>
                <Link href="/products">المنتجات <span aria-hidden="true">↗</span></Link>
                <Link href="/#collections">المجموعات <span aria-hidden="true">↗</span></Link>
              </div>
            </div>
            <div className="atelier-footer-bottom">
              <span>© {new Date().getFullYear()} زمزم ستور</span>
              <span>صُمّم بعناية للعربية <span aria-hidden="true">✳</span> EGYPT</span>
              <span>لا تُفعّل الطلبات حتى يكتمل ربط المتجر واختباراته.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}

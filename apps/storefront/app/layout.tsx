import type { Metadata } from "next"
import Link from "next/link"
import "./globals.css"

export const metadata: Metadata = {
  title: "زمزم ستور | Zamzam Store",
  description: "تصفح منتجات زمزم ستور من مياه زمزم المعبأة والتمور. الأسعار والمواصفات من كتالوج المتجر.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="topline">مرحبًا بك في زمزم ستور — تصفّح المنتجات المتاحة في الكتالوج</div>
        <header className="site-header">
          <div className="shell nav-layout">
            <Link href="/" className="brand" aria-label="زمزم ستور — الرئيسية">
              <span className="brand-icon" aria-hidden="true">ز</span>
              <span className="brand-text">زمزم <small>STORE</small></span>
            </Link>
            <nav className="nav-links" aria-label="التنقل الرئيسي">
              <Link href="/">الرئيسية</Link>
              <Link href="/products">المنتجات</Link>
            </nav>
            <Link href="/products" className="nav-cta">تسوق الآن <span aria-hidden="true">←</span></Link>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="shell footer-layout">
            <div><span className="footer-title">زمزم ستور</span><p>متجر إلكتروني عربي لعرض المنتجات المدرجة من مياه زمزم المعبأة والتمور.</p></div>
            <nav aria-label="روابط التذييل"><Link href="/">الرئيسية</Link><Link href="/products">المنتجات</Link></nav>
          </div>
          <div className="shell footer-bottom"><span>© {new Date().getFullYear()} زمزم ستور</span><span>جميع بيانات المنتجات مصدرها نظام المتجر</span></div>
        </footer>
      </body>
    </html>
  )
}

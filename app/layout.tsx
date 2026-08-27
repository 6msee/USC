import type { Metadata, Viewport } from 'next';
import { Kanit } from 'next/font/google';
import './globals.css';

const kanit = Kanit({
  variable: '--font-kanit',
  subsets: ['latin', 'thai'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ฟามCENT — สมุดบันทึกเทรดทอง',
  description: 'ติดตามกำไร XAUUSDc เงินทุน การถอน และมูลค่าพอร์ตใน USC, USD และ THB',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  manifest: '/manifest.webmanifest',
  applicationName: 'ฟามCENT',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'ฟามCENT' },
  icons: { icon: '/app-icon-192.png', apple: '/app-icon-192.png' },
  openGraph: {
    type: 'website',
    locale: 'th_TH',
    title: 'ฟามCENT — สมุดบันทึกเทรดทอง XAUUSDc',
    description: 'ติดตามกำไร USC พร้อมแปลงเป็น USD และเงินบาท จัดการพอร์ตได้ในที่เดียว',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'ฟามCENT สมุดบันทึกเทรดทอง XAUUSDc' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ฟามCENT — สมุดบันทึกเทรดทอง XAUUSDc',
    description: 'ติดตามกำไร USC พร้อมแปลงเป็น USD และเงินบาท',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#7058ef',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${kanit.variable} antialiased`}>{children}</body>
    </html>
  );
}

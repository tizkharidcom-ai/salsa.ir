import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'میزکار مدیریت یکپارچه',
  description: 'نسخه محلی پژوهشی از یک سامانه جامع مدیریت فروش، مالی، انبار و مشتریان',
  openGraph: { title: 'میزکار مدیریت یکپارچه', description: 'فروش، مالی، انبار و مشتریان', images: ['/og.png'], locale: 'fa_IR', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'میزکار مدیریت یکپارچه', description: 'فروش، مالی، انبار و مشتریان', images: ['/og.png'] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fa" dir="rtl"><body>{children}</body></html>; }

import type { Metadata, Viewport } from 'next';
import { Figtree, Newsreader } from 'next/font/google';
import './globals.css';

const sans = Figtree({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'Book Scanner',
  description: 'Scan the barcode on a book to see its details.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1E3B32',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}

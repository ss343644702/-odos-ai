import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Oii 互动',
  description: 'AI 驱动的互动故事创作与体验平台',
};

// Without this, mobile browsers render at a ~980px default width and let the page pan left/right.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover', // respect safe-area insets (notch) used by the player overlay
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

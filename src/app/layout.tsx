import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Odos AI',
  description: 'AI 驱动的互动故事创作与体验平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

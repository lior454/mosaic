import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mosaic',
  description: 'Multi-angle event video sharing',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="he" dir="rtl">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}

import type { Metadata } from 'next';
import { ReactQueryProvider } from '@/components/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAT-Inspect PWA',
  description: 'Operator PWA equipment list',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </body>
    </html>
  );
}

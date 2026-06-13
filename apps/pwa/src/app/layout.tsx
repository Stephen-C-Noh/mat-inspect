import type { Metadata } from 'next';
import { MsalProviderWrapper } from '@/components/msal-provider-wrapper';
import { ReactQueryProvider } from '@/components/query-provider';
import { TopBar } from '@/components/ui/top-bar';
import { AuthGuard } from '@/components/auth-guard';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAT-Inspect PWA',
  description: 'Operator PWA equipment list',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <MsalProviderWrapper>
          <ReactQueryProvider>
            <TopBar />
            <AuthGuard>{children}</AuthGuard>
          </ReactQueryProvider>
        </MsalProviderWrapper>
      </body>
    </html>
  );
}

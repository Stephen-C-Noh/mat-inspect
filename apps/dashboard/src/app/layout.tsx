import type { Metadata } from 'next';
import { MsalProviderWrapper } from '@/components/msal-provider-wrapper';
import { ReactQueryProvider } from '@/components/query-provider';
import '@mat-inspect/design-tokens/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAT-Inspect Dashboard',
  description: 'Manager dashboard for MAT-Inspect',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <MsalProviderWrapper>
          <ReactQueryProvider>{children}</ReactQueryProvider>
        </MsalProviderWrapper>
      </body>
    </html>
  );
}

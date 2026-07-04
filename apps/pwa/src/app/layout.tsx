import type { Metadata } from 'next';
import { MsalProviderWrapper } from '@/components/msal-provider-wrapper';
import { ReactQueryProvider } from '@/components/query-provider';
import { TopBar } from '@/components/ui/top-bar';
import { AuthGuard } from '@/components/auth-guard';
import '@mat-inspect/design-tokens/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAT-Inspect PWA',
  description: 'Operator PWA equipment list',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Runs before React hydrates to avoid a flash of light mode on dark preference */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mat-theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
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

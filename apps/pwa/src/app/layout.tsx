import type { Metadata, Viewport } from 'next';
import { MsalProviderWrapper } from '@/components/msal-provider-wrapper';
import { ReactQueryProvider } from '@/components/query-provider';
import { InspectionDraftProvider } from '@/components/inspection-draft-provider';
import { TopBar } from '@/components/ui/top-bar';
import { AuthGuard } from '@/components/auth-guard';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import '@mat-inspect/design-tokens/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAT-Inspect PWA',
  description: 'Operator PWA equipment list',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
};

// themeColor moved out of `metadata` in Next 15: it belongs on the viewport export, and Next
// warns on every build if left on metadata instead (DEV-144).
export const viewport: Viewport = {
  themeColor: '#004D87',
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
        <ServiceWorkerRegister />
        <MsalProviderWrapper>
          <ReactQueryProvider>
            <InspectionDraftProvider>
              <TopBar />
              <AuthGuard>{children}</AuthGuard>
            </InspectionDraftProvider>
          </ReactQueryProvider>
        </MsalProviderWrapper>
      </body>
    </html>
  );
}

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
    // A dedicated small icon, not icon-192.png: that one is sized for the Android install
    // prompt and its transparent background reads low-contrast in a dark browser tab strip at
    // favicon size, and fetching 16KB to draw 16px of it on every page load is wasteful
    // (DEV-144 review). favicon-32.png has an opaque background like apple-touch-icon.
    icon: '/favicon-32.png',
    apple: '/apple-touch-icon.png',
  },
  // iOS Safari does not read the manifest's `display: standalone` on every version; without
  // this, Add to Home Screen can still show Safari chrome and label the icon with the document
  // title instead of a short name (DEV-144 review).
  appleWebApp: {
    capable: true,
    title: 'MAT-Inspect',
    statusBarStyle: 'default',
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

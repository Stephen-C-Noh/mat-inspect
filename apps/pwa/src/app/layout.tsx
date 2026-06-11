import type { Metadata } from 'next';
import { MsalProviderWrapper } from '@/components/msal-provider-wrapper';

export const metadata: Metadata = {
  title: 'MAT-Inspect',
  description: 'Operator PWA for MAT-Inspect',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <MsalProviderWrapper>{children}</MsalProviderWrapper>
      </body>
    </html>
  );
}

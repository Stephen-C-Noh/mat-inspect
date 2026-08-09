'use client';

import { useEffect, useState } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { wireActiveAccount } from '@mat-inspect/shared-auth';
import { msalConfig } from '@/lib/auth';

const msalInstance = new PublicClientApplication(msalConfig);

export const MsalProviderWrapper = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    msalInstance.initialize().then(() => {
      wireActiveAccount(msalInstance);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Loading...</span>
      </div>
    );
  }

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
};

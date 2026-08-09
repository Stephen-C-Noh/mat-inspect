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
    let cancelled = false;
    let unwireActiveAccount: (() => void) | undefined;

    msalInstance.initialize().then(() => {
      if (cancelled) return;
      unwireActiveAccount = wireActiveAccount(msalInstance);
      setReady(true);
    });

    // Guards against React StrictMode's dev double-invoke (mount, unmount, mount)
    // registering the active-account event callback twice.
    return () => {
      cancelled = true;
      unwireActiveAccount?.();
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
};

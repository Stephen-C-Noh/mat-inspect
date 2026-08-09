'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { getActiveAccount, getRolesFromAccount, hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES, resolveLandingPath } from '@/lib/auth';

export default function RootPage() {
  const isAuthenticated = useIsAuthenticated();
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();

  // "/" is the app's configured redirectUri (it is the origin), so this is where Entra lands
  // the auth-code fragment after sign-in. Redirecting on the first, pre-settle render sends an
  // already-signed-in user to /login before handleRedirectPromise() gets a chance to process
  // that fragment (DEV-128, same race as AuthGuard).
  const msalInitializing =
    inProgress === InteractionStatus.Startup || inProgress === InteractionStatus.HandleRedirect;

  useEffect(() => {
    if (msalInitializing) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    const activeAccount = getActiveAccount(instance, accounts);
    if (!hasAllowedRole(activeAccount, ALLOWED_ROLES)) {
      router.replace('/unauthorized');
      return;
    }
    // Auditor is app-entry-allowed (DEV-112) but must not land on the write-adjacent
    // dashboard home; resolveLandingPath sends an auditor-only account to /audit instead.
    router.replace(resolveLandingPath(getRolesFromAccount(activeAccount)));
  }, [isAuthenticated, accounts, instance, router, msalInitializing]);

  return null;
}

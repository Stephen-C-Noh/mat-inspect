'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { getActiveAccount, hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES } from '@/lib/auth';

export const AuthGuard = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement | null => {
  const pathname = usePathname();
  const isAuthenticated = useIsAuthenticated();
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();

  const activeAccount = getActiveAccount(instance, accounts);
  const roleAllowed = hasAllowedRole(activeAccount, ALLOWED_ROLES);
  // MSAL restores the cached session and resolves any redirect response asynchronously.
  // Until inProgress settles to None, isAuthenticated reads false even for a signed-in
  // user, so redirecting now bounces deep links (e.g. /scan) out to /login then home.
  // Wait for MSAL to settle before deciding.
  const msalSettled = inProgress === InteractionStatus.None;

  useEffect(() => {
    if (pathname === '/login') return;
    if (!msalSettled) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!roleAllowed) {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, roleAllowed, router, pathname, msalSettled]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (!msalSettled) return null;

  if (!isAuthenticated || !roleAllowed) return null;

  return <>{children}</>;
};

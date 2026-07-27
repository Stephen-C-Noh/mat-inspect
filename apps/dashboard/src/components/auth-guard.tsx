'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import type { UserRole } from '@mat-inspect/shared-types';
import { ALLOWED_ROLES } from '@/lib/auth';

export const AuthGuard = ({
  children,
  allowedRoles = ALLOWED_ROLES,
}: {
  children: React.ReactNode;
  allowedRoles?: readonly UserRole[];
}): React.ReactElement | null => {
  const isAuthenticated = useIsAuthenticated();
  const { accounts, inProgress } = useMsal();
  const router = useRouter();
  const pathname = usePathname();

  const activeAccount = accounts[0] ?? null;
  const roleAllowed = hasAllowedRole(activeAccount, allowedRoles);
  // MSAL restores the cached session and resolves any redirect response asynchronously.
  // Until inProgress settles to None, isAuthenticated reads false even for a signed-in
  // user, so redirecting now bounces deep links (e.g. /fleet) out to /login then home
  // (DEV-128). Wait for MSAL to settle before deciding.
  const msalSettled = inProgress === InteractionStatus.None;

  useEffect(() => {
    if (!msalSettled) return;
    if (!isAuthenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!roleAllowed) {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, roleAllowed, router, pathname, msalSettled]);

  if (!msalSettled) return null;
  if (!isAuthenticated || !roleAllowed) return null;

  return <>{children}</>;
};

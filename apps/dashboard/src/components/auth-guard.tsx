'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import type { UserRole } from '@mat-inspect/shared-types';
import { ALLOWED_ROLES } from '@/lib/auth';

const AuthGuardInner = ({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: readonly UserRole[];
}): React.ReactElement | null => {
  const isAuthenticated = useIsAuthenticated();
  const { accounts, inProgress } = useMsal();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeAccount = accounts[0] ?? null;
  const roleAllowed = hasAllowedRole(activeAccount, allowedRoles);
  // MSAL restores the cached session (Startup) and resolves a just-completed sign-in redirect
  // (HandleRedirect) asynchronously; isAuthenticated reads false for a signed-in user until
  // either settles, so redirecting now bounces deep links (e.g. /fleet) out to /login then home
  // (DEV-128). Gate only on those two: a later AcquireToken interaction (e.g. the interactive
  // token-renewal redirect in acquireApiToken) is not "still starting up" and must not blank
  // an already-checked-in, role-allowed page.
  const msalInitializing =
    inProgress === InteractionStatus.Startup || inProgress === InteractionStatus.HandleRedirect;
  // /defects?id=<uuid> needs the query string back after sign-in to reopen the same detail
  // panel, not just the list (DEV-128).
  const query = searchParams.toString();
  const requestedPath = query ? `${pathname}?${query}` : pathname;

  useEffect(() => {
    if (msalInitializing) return;
    if (!isAuthenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(requestedPath)}`);
      return;
    }
    if (!roleAllowed) {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, roleAllowed, router, requestedPath, msalInitializing]);

  if (msalInitializing) return null;
  if (!isAuthenticated || !roleAllowed) return null;

  return <>{children}</>;
};

export const AuthGuard = ({
  children,
  allowedRoles = ALLOWED_ROLES,
}: {
  children: React.ReactNode;
  allowedRoles?: readonly UserRole[];
}): React.ReactElement => (
  <Suspense fallback={null}>
    <AuthGuardInner allowedRoles={allowedRoles}>{children}</AuthGuardInner>
  </Suspense>
);

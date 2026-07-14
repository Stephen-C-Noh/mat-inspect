'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES } from '@/lib/auth';

export const AuthGuard = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement | null => {
  const isAuthenticated = useIsAuthenticated();
  const { accounts } = useMsal();
  const router = useRouter();

  const activeAccount = accounts[0] ?? null;
  const roleAllowed = hasAllowedRole(activeAccount, ALLOWED_ROLES);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!roleAllowed) {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, roleAllowed, router]);

  if (!isAuthenticated || !roleAllowed) return null;

  return <>{children}</>;
};

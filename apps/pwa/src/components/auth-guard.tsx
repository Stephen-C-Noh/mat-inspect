'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES } from '@/lib/msal-config';

export const AuthGuard = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement | null => {
  const pathname = usePathname();
  const isAuthenticated = useIsAuthenticated();
  const { accounts } = useMsal();
  const router = useRouter();

  const activeAccount = accounts[0] ?? null;
  const roleAllowed = hasAllowedRole(activeAccount, ALLOWED_ROLES);

  useEffect(() => {
    if (pathname === '/login') return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!roleAllowed) {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, roleAllowed, router, pathname]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (!isAuthenticated || !roleAllowed) return null;

  return <>{children}</>;
};

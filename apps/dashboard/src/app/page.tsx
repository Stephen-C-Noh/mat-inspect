'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES } from '@/lib/auth';

export default function RootPage() {
  const isAuthenticated = useIsAuthenticated();
  const { accounts } = useMsal();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!hasAllowedRole(accounts[0] ?? null, ALLOWED_ROLES)) {
      router.replace('/unauthorized');
      return;
    }
    router.replace('/dashboard');
  }, [isAuthenticated, accounts, router]);

  return null;
}

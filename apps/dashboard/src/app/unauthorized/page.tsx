'use client';

import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import { getRolesFromAccount, hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES, resolveLandingPath } from '@/lib/auth';
import { SwitchAccountButton } from '@/components/switch-account-button';

// A signed-in, app-entry-allowed role (e.g. auditor) can still land here from a page whose own
// AuthGuard rejects it (dashboard, fleet): that account is not unauthorized, just pointed at the
// wrong page. Route it back to where it belongs instead of telling it to contact an
// administrator (DEV-112 follow-up). An account that failed the app-entry gate itself has no
// landing path and gets the original message.
export default function UnauthorizedPage() {
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const roles = getRolesFromAccount(account);
  const isAppEntryAllowed = hasAllowedRole(account, ALLOWED_ROLES);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow text-center">
        <p className="mb-1 text-4xl font-bold text-gray-300">403</p>
        <h1 className="mb-3 text-xl font-semibold text-gray-900">Access Denied</h1>
        {isAppEntryAllowed ? (
          <>
            <p className="mb-6 text-sm text-gray-600">
              Your role does not have access to this page.
            </p>
            <Link
              href={resolveLandingPath(roles)}
              className="mb-4 block text-sm font-medium text-blue-600 hover:underline"
            >
              Go to your area
            </Link>
          </>
        ) : (
          <p className="mb-6 text-sm text-gray-600">
            Your account does not have access to this dashboard. Contact your SAIT administrator to
            request access.
          </p>
        )}
        <SwitchAccountButton />
      </div>
    </main>
  );
}

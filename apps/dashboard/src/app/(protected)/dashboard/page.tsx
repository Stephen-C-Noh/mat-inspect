'use client';

import { useMsal } from '@azure/msal-react';
import { getRolesFromAccount } from '@mat-inspect/shared-auth';

export default function DashboardPage() {
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const roles = getRolesFromAccount(account);

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">MAT-Inspect Dashboard</h1>
        <p className="text-sm text-gray-500">
          {account?.username} &middot; {roles.join(', ')}
        </p>
      </div>
    </main>
  );
}

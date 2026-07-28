'use client';

import type { ReactElement } from 'react';
import { useMsal } from '@azure/msal-react';
import { getRolesFromAccount } from '@mat-inspect/shared-auth';
import { AuthGuard } from '@/components/auth-guard';
import { FailureQueue } from '@/components/dashboard/failure-queue';

function DashboardContent(): ReactElement {
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const roles = getRolesFromAccount(account);

  return (
    <main className="min-h-screen bg-muted p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-semibold text-foreground">MAT-Inspect Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {account?.username} &middot; {roles.join(', ')}
        </p>

        <div className="mt-6">
          <FailureQueue />
        </div>
      </div>
    </main>
  );
}

// Explicit override, not the (protected) layout's default: the layout's AuthGuard is now an
// app-entry gate that includes auditor (DEV-112), and this page shows the write-adjacent
// Failure Queue that auditor must not reach.
export default function DashboardPage(): ReactElement {
  return (
    <AuthGuard allowedRoles={['supervisor', 'manager', 'admin']}>
      <DashboardContent />
    </AuthGuard>
  );
}

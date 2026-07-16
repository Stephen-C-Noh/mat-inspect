'use client';

import type { ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { DefectsTable } from '@/components/defects/defects-table';

function DefectsContent(): ReactElement {
  return (
    <main className="min-h-screen bg-muted px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-extrabold text-foreground">Open Defects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acknowledge, track through repair, resolve, and approve return-to-service.
        </p>

        <div className="mt-6">
          <DefectsTable />
        </div>
      </div>
    </main>
  );
}

export default function DefectsPage(): ReactElement {
  return (
    <AuthGuard allowedRoles={['supervisor', 'manager']}>
      <DefectsContent />
    </AuthGuard>
  );
}

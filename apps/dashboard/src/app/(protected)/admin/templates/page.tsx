'use client';

import type { ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { TemplatesOverview } from '@/components/admin/templates/templates-overview';

function AdminTemplatesContent(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-muted px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-extrabold text-foreground">Checklist Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review publish history and publish new versions per equipment type.
        </p>

        <div className="mt-6">
          <TemplatesOverview />
        </div>
      </div>
    </main>
  );
}

export default function AdminTemplatesPage(): ReactElement {
  return (
    <AuthGuard allowedRoles={['admin']}>
      <AdminTemplatesContent />
    </AuthGuard>
  );
}

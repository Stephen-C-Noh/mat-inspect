'use client';

import type { ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { FleetGrid } from '@/components/fleet/fleet-grid';

function FleetContent(): ReactElement {
  return (
    <main className="min-h-screen bg-muted px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-extrabold text-foreground">Fleet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every machine's last inspection, operator, result, and current readiness. Select a machine
          for its full inspection history.
        </p>

        <div className="mt-6">
          <FleetGrid />
        </div>
      </div>
    </main>
  );
}

export default function FleetPage(): ReactElement {
  return (
    <AuthGuard>
      <FleetContent />
    </AuthGuard>
  );
}

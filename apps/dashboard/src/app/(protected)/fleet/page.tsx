'use client';

import type { ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { FleetGrid } from '@/components/fleet/fleet-grid';
import { OPERATIONAL_ROLES } from '@/lib/auth';

function FleetContent(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-muted px-6 py-8">
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

// Explicit override, not the (protected) layout's default: the layout's AuthGuard is now an
// app-entry gate that includes auditor (DEV-112), and Fleet is an operational page auditor
// must not reach.
export default function FleetPage(): ReactElement {
  return (
    <AuthGuard allowedRoles={OPERATIONAL_ROLES}>
      <FleetContent />
    </AuthGuard>
  );
}

'use client';

import type { ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { ALLOWED_ROLES } from '@/lib/auth';
import { AuditView } from '@/components/audit/audit-view';

function AuditContent(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-muted px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-extrabold text-foreground">Audit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspection history, signed exports, and chain integrity (ADR 0007, ADR 0008).
        </p>

        <div className="mt-6">
          <AuditView />
        </div>
      </div>
    </main>
  );
}

// The auditor's landing page (DEV-112): read-only, and deliberately its own route rather than
// a tab inside the write-capable dashboard. Supervisor/manager/admin get the same access
// (DEV-113); auditor gets exactly this and nothing else.
export default function AuditPage(): ReactElement {
  return (
    <AuthGuard allowedRoles={ALLOWED_ROLES}>
      <AuditContent />
    </AuthGuard>
  );
}

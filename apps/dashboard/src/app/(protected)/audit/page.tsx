'use client';

import type { ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { ALLOWED_ROLES } from '@/lib/auth';

function AuditContent(): ReactElement {
  return (
    <main className="min-h-screen bg-muted px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-extrabold text-foreground">Audit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspection history, signed exports, and chain verification land here (DEV-113). This page
          exists so an auditor has somewhere to sign in to.
        </p>
      </div>
    </main>
  );
}

// The auditor's landing page (DEV-112): read-only, and deliberately its own route rather than
// a tab inside the write-capable dashboard. Supervisor/manager/admin get the same access
// DEV-113 will build out; auditor gets exactly this and nothing else.
export default function AuditPage(): ReactElement {
  return (
    <AuthGuard allowedRoles={ALLOWED_ROLES}>
      <AuditContent />
    </AuthGuard>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import type { ReactElement } from 'react';
import { useMsal } from '@azure/msal-react';
import { ChevronRight, LogOut, Shield } from 'lucide-react';
import { getRolesFromAccount } from '@mat-inspect/shared-auth';
import { AuthGuard } from '@/components/auth-guard';

// Roles are checked in this order for the single badge shown on the account card: a manager
// account also carrying the supervisor role (Entra app roles are not hierarchical, see
// ARCHITECTURE.md section 3) should read as Manager, not Supervisor.
const ROLE_DISPLAY_PRIORITY = ['admin', 'manager', 'supervisor'] as const;
const ROLE_LABEL: Record<(typeof ROLE_DISPLAY_PRIORITY)[number], string> = {
  admin: 'Admin',
  manager: 'Manager',
  supervisor: 'Supervisor',
};

function SectionLabel({ children }: { children: string }): ReactElement {
  return (
    <p className="px-1 pb-1 pt-5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function SettingsContent(): ReactElement {
  const { instance, accounts } = useMsal();
  const router = useRouter();
  const account = accounts[0];

  const roles = getRolesFromAccount(account ?? null);
  const roleLabel = ROLE_DISPLAY_PRIORITY.find((role) => roles.includes(role));

  const handleSignOut = async (): Promise<void> => {
    try {
      await instance.logoutRedirect();
    } catch {
      // swallowed
    }
  };

  return (
    <main className="min-h-screen bg-muted">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-sm p-1.5 hover:bg-primary-foreground/10 transition-colors"
          aria-label="Go back"
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="text-sm font-extrabold uppercase tracking-wide">Settings</span>
      </header>

      <div className="mx-auto max-w-lg px-4 pb-12">
        {/* Account card */}
        <div className="mt-6 flex items-center gap-4 rounded-sm border border-border bg-card p-4 shadow-card">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-xl font-extrabold text-accent-foreground">
            {account?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <p className="text-base font-bold text-foreground">{account?.name ?? 'User'}</p>
            <p className="text-sm text-muted-foreground">{account?.username ?? ''}</p>
            {roleLabel && (
              <span className="mt-1 inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {ROLE_LABEL[roleLabel]}
              </span>
            )}
          </div>
        </div>

        {/* Security */}
        <SectionLabel>Security</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <div className="flex items-center gap-3 p-4">
            <div className="rounded-sm bg-muted p-2">
              <Shield className="size-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Privacy Policy</p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                MAT-Inspect collects inspection records, operator IDs, and equipment photos as
                required by Alberta OHS s.257. Voice clips are processed on SAIT infrastructure only
                and are never sent to external services.
              </p>
            </div>
          </div>
        </div>

        {/* Account */}
        <SectionLabel>Account</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 p-4 text-left"
          >
            <div className="rounded-sm bg-destructive/10 p-2">
              <LogOut className="size-5 text-destructive" />
            </div>
            <span className="font-semibold text-sm text-destructive">Sign Out</span>
          </button>
        </div>
      </div>
    </main>
  );
}

export default function SettingsPage(): ReactElement {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}

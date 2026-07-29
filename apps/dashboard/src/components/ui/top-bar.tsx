'use client';

import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import Image from 'next/image';
import type { ReactElement } from 'react';
import { getRolesFromAccount } from '@mat-inspect/shared-auth';
import type { UserRole } from '@mat-inspect/shared-types';
import { NotificationBell } from '@/components/ui/notification-bell';
import { AccountMenu } from '@/components/ui/account-menu';
import { ADMIN_ROLES, ALLOWED_ROLES, OPERATIONAL_ROLES, hasOperationalRole } from '@/lib/auth';

// Mirrors each page's own AuthGuard allowedRoles (dashboard/fleet/defects/audit/admin page.tsx).
// Dashboard, Fleet, and Audit reuse the shared OPERATIONAL_ROLES / ALLOWED_ROLES constants so
// they cannot drift from the pages they link to; Defects keeps its own literal because that
// page's gate diverges from both (excludes admin today) for reasons specific to it, not a
// shared source of truth. This list exists only to avoid showing a link that 403s.
const NAV_LINKS: ReadonlyArray<{
  href: string;
  label: string;
  allowedRoles: readonly UserRole[];
}> = [
  { href: '/dashboard', label: 'Dashboard', allowedRoles: OPERATIONAL_ROLES },
  { href: '/fleet', label: 'Fleet', allowedRoles: OPERATIONAL_ROLES },
  { href: '/defects', label: 'Defects', allowedRoles: ['supervisor', 'manager'] },
  { href: '/audit', label: 'Audit', allowedRoles: ALLOWED_ROLES },
  { href: '/admin/templates', label: 'Admin', allowedRoles: ADMIN_ROLES },
];

export const TopBar = function (): ReactElement | null {
  const { accounts } = useMsal();
  const activeAccount = accounts[0];

  if (!activeAccount) return null;

  const roles = getRolesFromAccount(activeAccount);
  const visibleLinks = NAV_LINKS.filter((link) =>
    link.allowedRoles.some((role) => roles.includes(role)),
  );
  // /api/v1/activity (behind NotificationBell, via ActivityProvider) does not accept auditor;
  // showing a bell that can never carry data reads as "nothing has happened" rather than "this
  // isn't for your role" (DEV-112 follow-up).
  const isOperational = hasOperationalRole(roles);

  return (
    <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image
            src="/sait-logo.png"
            alt="SAIT"
            width={116}
            height={32}
            className="h-7 w-auto shrink-0"
          />
          <h1 className="font-bold text-lg tracking-wide">SCHOOL OF MAT</h1>
        </Link>
        <nav className="flex gap-4 pl-4 text-sm font-semibold">
          {visibleLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:opacity-80">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {/* The account menu's dropdown repeats the name (account-menu.tsx), so this is
            redundant on a narrow header; keep it only where there's room to spare. */}
        <span className="hidden text-sm font-medium sm:inline">{activeAccount.name}</span>
        {isOperational && <NotificationBell />}
        <AccountMenu />
      </div>
    </header>
  );
};

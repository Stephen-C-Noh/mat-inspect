'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import Image from 'next/image';
import { LayoutDashboard, Menu, ScrollText, Settings, TriangleAlert, Truck } from 'lucide-react';
import { useState, type ComponentType, type ReactElement } from 'react';
import { getActiveAccount, getRolesFromAccount } from '@mat-inspect/shared-auth';
import type { UserRole } from '@mat-inspect/shared-types';
import { NotificationBell } from '@/components/ui/notification-bell';
import { AccountMenu } from '@/components/ui/account-menu';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { ADMIN_ROLES, ALLOWED_ROLES, OPERATIONAL_ROLES, hasOperationalRole } from '@/lib/auth';

// Mirrors each page's own AuthGuard allowedRoles (dashboard/fleet/defects/audit/admin page.tsx).
// Dashboard, Fleet, and Audit reuse the shared OPERATIONAL_ROLES / ALLOWED_ROLES constants so
// they cannot drift from the pages they link to; Defects keeps its own literal because that
// page's gate diverges from both (excludes admin today) for reasons specific to it, not a
// shared source of truth. This list exists only to avoid showing a link that 403s.
const NAV_LINKS: ReadonlyArray<{
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  allowedRoles: readonly UserRole[];
}> = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    allowedRoles: OPERATIONAL_ROLES,
  },
  { href: '/fleet', label: 'Fleet', icon: Truck, allowedRoles: OPERATIONAL_ROLES },
  {
    href: '/defects',
    label: 'Defects',
    icon: TriangleAlert,
    allowedRoles: ['supervisor', 'manager'],
  },
  { href: '/audit', label: 'Audit', icon: ScrollText, allowedRoles: ALLOWED_ROLES },
  { href: '/admin/templates', label: 'Admin', icon: Settings, allowedRoles: ADMIN_ROLES },
];

export const TopBar = function (): ReactElement | null {
  const { instance, accounts } = useMsal();
  const activeAccount = getActiveAccount(instance, accounts);
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

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
    <header className="bg-primary text-primary-foreground p-3 sm:p-4 flex items-center justify-between w-full">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground md:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
            <SheetHeader className="border-b border-border p-4 text-left">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col divide-y divide-border">
              {visibleLinks.map((link) => {
                const Icon = link.icon;
                const active = pathname?.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 text-sm font-semibold outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                      active && 'bg-accent/10 text-accent',
                    )}
                    onClick={() => setNavOpen(false)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
        <Link href="/dashboard" className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Image
            src="/sait-logo.png"
            alt="SAIT"
            width={116}
            height={32}
            className="h-5 sm:h-7 w-auto shrink-0"
          />
          <h1 className="font-bold text-sm sm:text-lg tracking-wide truncate">SCHOOL OF MAT</h1>
        </Link>
        <nav className="hidden md:flex gap-4 pl-4 text-sm font-semibold">
          {visibleLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-sm outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* The account menu's dropdown repeats the name (account-menu.tsx), so this is
            redundant on a narrow header; keep it only where there's room to spare. */}
        <span className="hidden text-sm font-medium sm:inline">{activeAccount.name}</span>
        {isOperational && <NotificationBell />}
        <AccountMenu />
      </div>
    </header>
  );
};

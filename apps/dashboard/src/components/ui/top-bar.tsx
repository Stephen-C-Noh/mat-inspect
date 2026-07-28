'use client';

import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import type { ReactElement } from 'react';
import { User } from 'lucide-react';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import { NotificationBell } from '@/components/ui/notification-bell';
import { ADMIN_ROLES } from '@/lib/auth';

export const TopBar = function (): ReactElement | null {
  const { accounts } = useMsal();
  const activeAccount = accounts[0];

  if (!activeAccount) return null;

  const isAdmin = hasAllowedRole(activeAccount, ADMIN_ROLES);

  return (
    <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <div className="bg-card p-1 rounded font-bold text-primary text-xs text-center">
          <span className="block text-[10px] text-red-600">SAIT</span>
        </div>
        <h1 className="font-bold text-lg tracking-wide">MAT SCHOOL</h1>
        <nav className="flex gap-4 pl-4 text-sm font-semibold">
          <Link href="/dashboard" className="hover:opacity-80">
            Dashboard
          </Link>
          <Link href="/fleet" className="hover:opacity-80">
            Fleet
          </Link>
          <Link href="/defects" className="hover:opacity-80">
            Defects
          </Link>
          {isAdmin && (
            <Link href="/admin/templates" className="hover:opacity-80">
              Admin
            </Link>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">{activeAccount.name}</span>
        <NotificationBell />
        {/* TODO: Flagged - Replace with 'darker-primary' token once defined */}
        <User className="size-6 bg-muted-foreground p-1 rounded-full cursor-pointer" />
      </div>
    </header>
  );
};

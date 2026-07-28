'use client';

import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import Image from 'next/image';
import type { ReactElement } from 'react';
import { NotificationBell } from '@/components/ui/notification-bell';
import { AccountMenu } from '@/components/ui/account-menu';

export const TopBar = function (): ReactElement | null {
  const { accounts } = useMsal();
  const activeAccount = accounts[0];

  if (!activeAccount) return null;

  return (
    <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image src="/sait-logo.png" alt="SAIT" width={116} height={32} className="h-8 w-auto" />
          <h1 className="font-bold text-lg tracking-wide">SCHOOL OF MAT</h1>
        </Link>
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
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">{activeAccount.name}</span>
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
};

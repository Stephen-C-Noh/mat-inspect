'use client';

import { useMsal } from '@azure/msal-react';
import Image from 'next/image';
import type { ReactElement } from 'react';
import { Bell } from 'lucide-react';
import { AccountMenu } from '@/components/ui/account-menu';

export const TopBar = function (): ReactElement | null {
  const { accounts } = useMsal();
  const activeAccount = accounts[0];

  if (!activeAccount) return null;

  return (
    <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <Image src="/sait-logo.png" alt="SAIT" width={116} height={32} className="h-8 w-auto" />
        <h1 className="font-bold text-lg tracking-wide">MAT SCHOOL</h1>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">{activeAccount.name}</span>
        <Bell className="size-6 cursor-pointer" />
        <AccountMenu />
      </div>
    </header>
  );
};

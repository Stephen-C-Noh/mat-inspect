'use client';

import { useMsal } from '@azure/msal-react';
import { getActiveAccount } from '@mat-inspect/shared-auth';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { AccountMenu } from '@/components/ui/account-menu';

export const TopBar = function (): ReactElement | null {
  const { instance, accounts } = useMsal();
  const activeAccount = getActiveAccount(instance, accounts);

  if (!activeAccount) return null;

  return (
    <header className="bg-primary text-primary-foreground p-3 sm:p-4 flex items-center justify-between w-full">
      <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Image
          src="/sait-logo.png"
          alt="SAIT"
          width={116}
          height={32}
          className="h-5 sm:h-7 w-auto shrink-0"
        />
        <h1 className="font-bold text-sm sm:text-lg tracking-wide truncate">SCHOOL OF MAT</h1>
      </Link>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* The account menu's dropdown repeats the name (account-menu.tsx), so this is
            redundant on a narrow header; keep it only where there's room to spare. */}
        <span className="hidden text-sm font-medium sm:inline">{activeAccount.name}</span>
        <AccountMenu />
      </div>
    </header>
  );
};

'use client';

import { useMsal } from '@azure/msal-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { AccountMenu } from '@/components/ui/account-menu';

export const TopBar = function (): ReactElement | null {
  const { accounts } = useMsal();
  const activeAccount = accounts[0];

  if (!activeAccount) return null;

  return (
    <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between w-full">
      <Link href="/" className="flex items-center gap-3">
        <Image
          src="/sait-logo.png"
          alt="SAIT"
          width={116}
          height={32}
          className="h-7 w-auto shrink-0"
        />
        <h1 className="font-bold text-lg tracking-wide">SCHOOL OF MAT</h1>
      </Link>

      <div className="flex items-center gap-4">
        {/* The account menu's dropdown repeats the name (account-menu.tsx), so this is
            redundant on a narrow header; keep it only where there's room to spare. */}
        <span className="hidden text-sm font-medium sm:inline">{activeAccount.name}</span>
        <AccountMenu />
      </div>
    </header>
  );
};

'use client';

import { useMsal } from '@azure/msal-react';
import type { ReactElement } from 'react';
import { Bell, User } from 'lucide-react';

export const TopBar = function (): ReactElement | null {
  const { accounts } = useMsal();
  const activeAccount = accounts[0];

  if (!activeAccount) return null;

  return (
    <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <div className="bg-card p-1 rounded font-bold text-primary text-xs text-center">
          <span className="block text-[10px] text-red-600">SAIT</span>
        </div>
        <h1 className="font-bold text-lg tracking-wide">MAT SCHOOL</h1>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">{activeAccount.name}</span>
        <Bell className="size-6 cursor-pointer" />
        {/* TODO: Flagged - Replace with 'darker-primary' token once defined */}
        <User className="size-6 bg-muted-foreground p-1 rounded-full cursor-pointer" />
      </div>
    </header>
  );
};

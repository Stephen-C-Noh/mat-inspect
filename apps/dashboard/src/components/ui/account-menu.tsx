'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import { getActiveAccount, getLogoutHint } from '@mat-inspect/shared-auth';
import { HelpCircle, LogOut, Settings, User } from 'lucide-react';

export const AccountMenu = (): ReactElement | null => {
  const { instance, accounts } = useMsal();
  const activeAccount = getActiveAccount(instance, accounts);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Mouse-only close was the gap: a keyboard user who opens the menu with Enter had no way
    // to dismiss it without a pointer.
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!activeAccount) return null;

  // Clears the whole local MSAL cache, not just this account: DEV-151's ADR 0027 bootstrap
  // guard would have forced that anyway on the next load if any other account were left
  // cached with no active designation, so there is no reason to leave one behind on purpose.
  // logoutHint still targets the active account's Entra session, so Entra skips the "which
  // account do you want to sign out of?" picker when the browser holds more than one
  // Microsoft session (same reasoning as SwitchAccountButton, used on /unauthorized).
  const handleSignOut = (): void => {
    void instance.logoutRedirect({ logoutHint: getLogoutHint(activeAccount) });
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
      >
        {/* TODO: Flagged - Replace with 'darker-primary' token once defined */}
        <User className="size-6 bg-muted-foreground p-1 rounded-full cursor-pointer" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-2 w-56 rounded-sm border border-border bg-card py-1 text-foreground shadow-card"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-semibold">{activeAccount.name}</p>
            <p className="truncate text-xs text-muted-foreground">{activeAccount.username}</p>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <Settings className="size-4" />
            Settings
          </Link>
          <Link
            href="/help"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <HelpCircle className="size-4" />
            Help
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

'use client';

import { useMsal } from '@azure/msal-react';
import type { ReactElement } from 'react';

export const TopBar = function (): ReactElement | null {
  const { instance, accounts } = useMsal();
  const activeAccount = accounts[0];

  const handleSignOut = async function (): Promise<void> {
    try {
      await instance.logoutRedirect();
    } catch {
      // Swallowed error to satisfy lint rules
    }
  };

  // No session means the login screen (or pre-redirect flash on a guarded route),
  // where app chrome and a Sign Out button do not belong. /unauthorized still has
  // an account, so the bar stays and the user can sign out from there.
  if (!activeAccount) return null;

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 shadow-sm">
      <div className="font-bold text-gray-900">MAT-Inspect</div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">{activeAccount.name}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="rounded bg-red-50 px-3 py-1 text-sm text-red-600 hover:bg-red-100"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
};

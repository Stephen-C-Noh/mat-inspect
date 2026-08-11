'use client';

import { useMsal } from '@azure/msal-react';
import { getLogoutHint } from '@mat-inspect/shared-auth';

// Signs the current user out so a denied account can return to /login and sign in with a
// different one. Clears the whole local MSAL cache (not just the active account), so no
// stale cached account is left for DEV-151's ADR 0027 bootstrap guard to clear on the next
// load anyway. login_hint still targets the active account's Entra session, so Entra skips
// the "which account do you want to sign out of?" picker when the browser holds more than
// one Microsoft session. A real SAIT user has a single account and never sees the picker
// regardless.
export const SwitchAccountButton = (): React.ReactElement => {
  const { instance } = useMsal();

  const handleSignOut = () => {
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null;
    void instance.logoutRedirect({ logoutHint: getLogoutHint(account) });
  };

  return (
    <button onClick={handleSignOut} className="text-sm text-blue-600 hover:underline">
      Sign out and use a different account
    </button>
  );
};

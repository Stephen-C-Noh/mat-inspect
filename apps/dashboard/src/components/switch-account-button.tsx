'use client';

import { useMsal } from '@azure/msal-react';

// Signs the current user out so a denied account can return to /login and sign in
// with a different one. Passing the active account and its login_hint targets that
// one account, so Entra skips the "which account do you want to sign out of?" picker
// when the browser holds more than one Microsoft session. A real SAIT user has a
// single account and never sees the picker regardless.
export const SwitchAccountButton = (): React.ReactElement => {
  const { instance } = useMsal();

  const handleSignOut = () => {
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null;
    const claims = account?.idTokenClaims as Record<string, unknown> | undefined;
    const logoutHint =
      typeof claims?.['login_hint'] === 'string' ? claims['login_hint'] : undefined;
    void instance.logoutRedirect({ account, logoutHint });
  };

  return (
    <button onClick={handleSignOut} className="text-sm text-blue-600 hover:underline">
      Sign out and use a different account
    </button>
  );
};

'use client';

import { useMsal } from '@azure/msal-react';

// Fully signs the current user out (clears MSAL cache and ends the Entra SSO
// session), then returns to the app where the root page routes to /login. A
// denied user cannot reach a sign-in prompt without this; they stay logged in
// and bounce back to /unauthorized.
export const SwitchAccountButton = (): React.ReactElement => {
  const { instance } = useMsal();

  return (
    <button
      onClick={() => void instance.logoutRedirect()}
      className="text-sm text-blue-600 hover:underline"
    >
      Sign in with a different account
    </button>
  );
};

import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { tokenRequest } from '@/lib/msal-config';

// Acquire the Core API access token silently. If the session expired or consent is missing,
// MSAL throws InteractionRequiredAuthError; fall back to a redirect so the user
// re-authenticates instead of the query failing permanently. Shared by the data hooks so
// the token-acquisition path lives in one place.
export const acquireAccessToken = async (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
): Promise<string> => {
  try {
    const response = await instance.acquireTokenSilent({ ...tokenRequest, account: accounts[0] });
    return response.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await instance.acquireTokenRedirect({ ...tokenRequest, account: accounts[0] });
    }
    throw err;
  }
};

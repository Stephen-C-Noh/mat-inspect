import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import type { TokenRequest } from './msal-config';

// Acquires an API access token silently. If the session expired or consent is missing, MSAL
// throws InteractionRequiredAuthError; fall back to a redirect so the user re-authenticates
// instead of the caller failing permanently.
//
// The error is rethrown in every case, including after the redirect is started. Callers rely
// on it: the voice-note transcribe path turns it into a soft failure that leaves the note
// field typable rather than blocking the inspection (ADR 0017).
export const acquireApiToken = async (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
  tokenRequest: TokenRequest,
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

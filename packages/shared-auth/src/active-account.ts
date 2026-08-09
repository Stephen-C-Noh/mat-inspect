import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { EventType } from '@azure/msal-browser';

// The account MSAL has designated active, falling back to the first cached account. Once a
// device has more than one cached account (a second sign-in, cacheLocation: localStorage
// keeping an earlier operator's entry around, ADR 0027), accounts[0] is cache insertion
// order, not "the operator using this session" (DEV-151 follow-up). Every read of "who is
// signed in" should go through this instead of accounts[0] directly.
//
// instance.getActiveAccount is optional on IPublicClientApplication only for test doubles
// that stub a narrower interface; a real MSAL instance always has it.
export const getActiveAccount = (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
): AccountInfo | null =>
  (typeof instance?.getActiveAccount === 'function' ? instance.getActiveAccount() : null) ??
  accounts[0] ??
  null;

// Keeps MSAL's active-account designation current. Call once per PublicClientApplication
// instance, before rendering with it (see each app's MsalProviderWrapper).
//
// Bootstraps from the cache on first load, since a session restored from a previous page
// load fires no LOGIN_SUCCESS event to hang the designation off of, then tracks every
// sign-in and token acquisition after that.
export const wireActiveAccount = (instance: IPublicClientApplication): void => {
  if (!instance.getActiveAccount()) {
    const [firstCached] = instance.getAllAccounts();
    if (firstCached) instance.setActiveAccount(firstCached);
  }

  instance.addEventCallback((event) => {
    const isSuccess =
      event.eventType === EventType.LOGIN_SUCCESS ||
      event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS;
    if (!isSuccess) return;

    const payload = event.payload;
    const account =
      payload && typeof payload === 'object' && 'account' in payload
        ? ((payload as { account: AccountInfo | null }).account ?? null)
        : null;
    if (account) instance.setActiveAccount(account);
  });
};

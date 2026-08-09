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
//
// Not a reactive read: msal-react only re-renders on a change to inProgress or to the
// accounts array, neither of which changes when only the active designation does. Every
// caller today only reaches this after loginRedirect/logoutRedirect, both full navigations
// that remount the app, so it is current in practice. It would go stale if a caller started
// switching accounts via ssoSilent, acquireTokenPopup, or a direct setActiveAccount call
// without a navigation, since nothing would force affected components to re-render.
export const getActiveAccount = (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
): AccountInfo | null =>
  (typeof instance?.getActiveAccount === 'function' ? instance.getActiveAccount() : null) ??
  accounts[0] ??
  null;

// Keeps MSAL's active-account designation current. Call once per PublicClientApplication
// instance and await it before rendering with it (see each app's MsalProviderWrapper), and
// call the returned cleanup on unmount so a remount (React StrictMode's dev double-invoke,
// or a second MsalProviderWrapper instance) does not accumulate duplicate event callbacks.
//
// Bootstraps from the cache on first load, since a session restored from a previous page
// load fires no LOGIN_SUCCESS event to hang the designation off of, then tracks every
// sign-in and token acquisition after that.
//
// The bootstrap only promotes an account when exactly one is cached. Two or more cached
// accounts with no active designation is what a targeted sign-out leaves behind (account-menu
// and switch-account-button log out one account by id; any others stay cached), and guessing
// which of several real identities to continue as is exactly the Part 6 misattribution risk
// this module exists to close. msal-react's useIsAuthenticated only checks accounts.length,
// not the active designation, so leaving the choice merely unset would not force a re-login;
// clearing the cache does.
//
// clearCache is awaited, not fired and forgotten: MsalProvider's initial state reads
// instance.getAllAccounts() synchronously on its first render (a useReducer lazy
// initializer), with no re-render when clearCache later finishes, since clearCache emits no
// MSAL event. A caller that renders MsalProvider before this promise settles would freeze
// that first render's account list to whatever was cached before the clear, defeating the
// whole point of clearing it.
export const wireActiveAccount = async (
  instance: IPublicClientApplication,
): Promise<() => void> => {
  if (!instance.getActiveAccount()) {
    const cached = instance.getAllAccounts();
    if (cached.length === 1) {
      instance.setActiveAccount(cached[0]);
    } else if (cached.length > 1) {
      await instance.clearCache();
    }
  }

  const callbackId = instance.addEventCallback((event) => {
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

  return () => {
    if (callbackId) instance.removeEventCallback(callbackId);
  };
};

import type { Configuration } from '@azure/msal-browser';

export type EntraConfig = {
  clientId: string;
  tenantId: string;
};

export type TokenRequest = {
  scopes: string[];
};

export type LoginRequest = {
  scopes: string[];
  prompt: string;
};

// Both apps register the page origin itself as the redirect URI, with no trailing slash,
// or Entra rejects the return. Reading window here means the config must be built in the
// browser; on the server the origin is empty and MSAL is never instantiated.
//
// navigateToLoginRequestUrl is left at its MSAL default (true). An earlier version of this
// config set it to false on the reasoning that both apps redirect to the origin, so there is
// no "page that launched login" to hop back to; that missed that the dashboard's AuthGuard
// sends an unauthenticated deep link to /login?redirect=<path> (DEV-128) and depends on this
// default hop to land back there after sign-in. Setting it false silently dropped that
// redirect and returned every login to the origin instead. See ADR 0027.
export const createMsalConfig = ({ clientId, tenantId }: EntraConfig): Configuration => ({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
    postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : '',
  },
  // cacheLocation: localStorage. Devices are individually assigned per operator, not
  // shared (ADR 0007, ADR 0025), and the PWA is installed to the home screen (DEV-144),
  // where Android can kill the process between launches; sessionStorage would force a
  // relogin on nearly every relaunch. See ADR 0027.
  //
  // storeAuthStateInCookie backs up the redirect-in-progress state (PKCE verifier, state,
  // nonce) to a cookie, since MSAL always keeps that temporary state in sessionStorage or
  // memory regardless of cacheLocation, and an installed PWA's out-of-scope navigation to
  // login.microsoftonline.com may not return to the same browsing context (DEV-151).
  // secureCookies defaults to false in MSAL; without it that cookie would go out
  // unencrypted on any plain-HTTP hop (Caddy's own 80->443 redirect is one). No token or
  // JWT is ever stored in the cookie, only the redirect handshake state.
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: true,
    secureCookies: true,
  },
});

// The scope the services validate. The app registration exposes access_as_user and sets
// requestedAccessTokenVersion: 2, so the token's aud is the clientId and its issuer ends
// in /v2.0. See ADR 0012.
export const apiScope = (clientId: string): string => `api://${clientId}/access_as_user`;

export const createTokenRequest = (clientId: string): TokenRequest => ({
  scopes: [apiScope(clientId)],
});

// withApiScope belongs to apps that call the API (the PWA), so consent for access_as_user
// is collected at login rather than on the first silent acquisition. The dashboard signs in
// for identity only and asks for openid/profile alone. prompt: 'select_account' always shows
// the account picker, so a user can sign in as someone else while Entra holds an SSO session.
export const createLoginRequest = (
  clientId: string,
  { withApiScope = false }: { withApiScope?: boolean } = {},
): LoginRequest => ({
  scopes: withApiScope ? ['openid', 'profile', apiScope(clientId)] : ['openid', 'profile'],
  prompt: 'select_account',
});

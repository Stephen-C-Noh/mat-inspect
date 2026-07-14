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
export const createMsalConfig = ({ clientId, tenantId }: EntraConfig): Configuration => ({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
    postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : '',
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
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

import type { Configuration, PopupRequest } from '@azure/msal-browser';

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID ?? ''}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
    postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : '',
  },
  cache: {
    cacheLocation: 'memory',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile'],
  prompt: 'select_account',
};

export const ALLOWED_ROLES = ['Operator', 'Supervisor'] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

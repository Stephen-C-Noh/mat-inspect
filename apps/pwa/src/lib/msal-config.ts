import type { Configuration } from '@azure/msal-browser';
import type { UserRole } from '@mat-inspect/shared-types';

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID ?? ''}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
    postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : '',
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

// Updated loginRequest to be fully compatible with Redirect flows
export const loginRequest: { scopes: string[]; prompt: string } = {
  scopes: ['openid', 'profile', `api://${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID}/access_as_user`],
  prompt: 'select_account',
};

// Roles permitted to use the operator PWA. Values must match the Entra app role
// values, which are lowercase (see core-api requireRole and shared-types UserRole).
export const ALLOWED_ROLES = ['operator', 'supervisor'] as const satisfies readonly UserRole[];
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

export const tokenRequest = {
  scopes: [`api://${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID}/access_as_user`],
};

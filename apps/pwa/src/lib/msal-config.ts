import type { Configuration, PopupRequest } from '@azure/msal-browser';
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

export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile'],
  prompt: 'select_account',
};

// Roles permitted to use the operator PWA. Values must match the Entra app role
// values, which are lowercase (see core-api requireRole and shared-types UserRole).
export const ALLOWED_ROLES = ['operator', 'supervisor'] as const satisfies readonly UserRole[];
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

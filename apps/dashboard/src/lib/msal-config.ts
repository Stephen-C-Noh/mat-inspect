import type { Configuration, PopupRequest } from '@azure/msal-browser';

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID ?? ''}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
    // Match the registered redirect URI exactly (origin, no trailing slash) so
    // Entra accepts the post-logout return. After logout the user lands on the
    // root page, which routes them to /login.
    postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : '',
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile'],
  // Always show the account picker so a user can sign in as someone else even
  // when Entra holds an active SSO session.
  prompt: 'select_account',
};

// Roles permitted to view the dashboard. Supervisor gets the team dashboard,
// Manager and Admin get full read access. See ARCHITECTURE.md section 3 (roles).
export const ALLOWED_ROLES = ['Supervisor', 'Manager', 'Admin'] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

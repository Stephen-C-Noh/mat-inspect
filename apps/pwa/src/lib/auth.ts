import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import {
  acquireApiToken,
  createLoginRequest,
  createMsalConfig,
  createTokenRequest,
} from '@mat-inspect/shared-auth';
import type { UserRole } from '@mat-inspect/shared-types';

// Next inlines NEXT_PUBLIC_* at build time, so the env reads stay in app code and the shared
// package takes the values as arguments. A missing value is caught at boot by the environment
// validator (ADR 0015); the fallback only keeps the module importable.
const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '';
const tenantId = process.env.NEXT_PUBLIC_AZURE_TENANT_ID ?? '';

export const msalConfig = createMsalConfig({ clientId, tenantId });

// The PWA calls core-api, so it collects consent for the API scope at login.
export const loginRequest = createLoginRequest(clientId, { withApiScope: true });

export const tokenRequest = createTokenRequest(clientId);

// Binds the PWA's token request once. Callers pass the MSAL instance and accounts from
// useMsal(). Throws on failure, including after a redirect is started (ADR 0017).
export const acquireAccessToken = (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
): Promise<string> => acquireApiToken(instance, accounts, tokenRequest);

// Roles permitted to use the operator PWA. Values must match the Entra app role values,
// which are lowercase (see core-api requireRole and shared-types UserRole).
export const ALLOWED_ROLES = ['operator', 'supervisor'] as const satisfies readonly UserRole[];
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

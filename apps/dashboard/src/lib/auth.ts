import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import {
  acquireApiToken,
  acquireApiTokenSilent,
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

// The dashboard calls core-api (defects, equipment), so it collects consent for the API
// scope at login, same as the PWA.
export const loginRequest = createLoginRequest(clientId, { withApiScope: true });

export const tokenRequest = createTokenRequest(clientId);

export const acquireAccessToken = (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
): Promise<string> => acquireApiToken(instance, accounts, tokenRequest);

// For the activity poll, which runs on a timer and must never start an interactive redirect on
// its own (ADR 0026).
export const acquireAccessTokenSilent = (
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
): Promise<string> => acquireApiTokenSilent(instance, accounts, tokenRequest);

// Roles permitted to view the dashboard. Supervisor gets the team dashboard, Manager and
// Admin get full read access. See ARCHITECTURE.md section 3 (roles). Values must match the
// Entra app role values, which are lowercase (see core-api requireRole and shared-types
// UserRole).
export const ALLOWED_ROLES = [
  'supervisor',
  'manager',
  'admin',
] as const satisfies readonly UserRole[];
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

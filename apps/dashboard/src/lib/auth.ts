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

// Roles permitted into the dashboard app at all (login page, root redirect, and the
// (protected) layout's default AuthGuard). This is an app-entry gate, not a per-page one: it
// says nothing about which pages a role can see once inside. Auditor is here so DEV-112's
// entry point exists, but auditor must not gain the operational pages this gate used to imply
// access to (dashboard, fleet) — those pages now carry their own explicit allowedRoles
// override (see their page.tsx) so adding a role here never silently opens write-adjacent
// screens to it (ADR 0021 amendment). Values must match the Entra app role values, which are
// lowercase (see core-api requireRole and shared-types UserRole).
export const ALLOWED_ROLES = [
  'supervisor',
  'manager',
  'admin',
  'auditor',
] as const satisfies readonly UserRole[];
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

// Pages an auditor may land on. Kept separate from ALLOWED_ROLES so a future role added to
// the app-entry gate does not automatically inherit dashboard/fleet access.
const OPERATIONAL_ROLES = ['supervisor', 'manager', 'admin'] as const satisfies readonly UserRole[];

// Where to send a signed-in, role-allowed user with no more specific destination (root page,
// login page). An auditor holding no operational role lands on the read-only Audit section
// instead of the write-adjacent dashboard home.
export const resolveLandingPath = (roles: readonly string[]): string =>
  roles.some((role) => (OPERATIONAL_ROLES as readonly string[]).includes(role))
    ? '/dashboard'
    : roles.includes('auditor')
      ? '/audit'
      : '/dashboard';

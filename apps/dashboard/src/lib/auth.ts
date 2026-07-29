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

// Roles that may see the write-adjacent operational pages (dashboard, fleet): each such page
// carries its own explicit AuthGuard allowedRoles override equal to this list, rather than
// inheriting the (protected) layout's default. Exported so ALLOWED_ROLES below is derived from
// it instead of listed separately, and so other role-aware call sites (ActivityProvider, TopBar)
// use the same source instead of a fourth copy of "supervisor, manager, admin".
export const OPERATIONAL_ROLES = [
  'supervisor',
  'manager',
  'admin',
] as const satisfies readonly UserRole[];

export const hasOperationalRole = (roles: readonly string[]): boolean =>
  roles.some((role) => (OPERATIONAL_ROLES as readonly string[]).includes(role));

// Roles permitted into the dashboard app at all (login page, root redirect, and the
// (protected) layout's default AuthGuard). This is an app-entry gate, not a per-page one: it
// says nothing about which pages a role can see once inside. Derived from OPERATIONAL_ROLES
// plus auditor (DEV-112) so the two lists cannot drift apart; a role added only here would
// silently gain nothing beyond app entry, not the operational pages, since those check
// OPERATIONAL_ROLES directly. Values must match the Entra app role values, which are lowercase
// (see core-api requireRole and shared-types UserRole).
export const ALLOWED_ROLES = [
  ...OPERATIONAL_ROLES,
  'auditor',
] as const satisfies readonly UserRole[];
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

// Gates the Admin nav entry and the /admin/* screens (checklist template management).
export const ADMIN_ROLES = ['admin'] as const satisfies readonly UserRole[];

// Where to send a signed-in, role-allowed user with no more specific destination (root page,
// login page). Every role in ALLOWED_ROLES is either operational or auditor, so the final
// '/dashboard' is not a guessed default: it is what a role holding neither case reaches only if
// it was let past the ALLOWED_ROLES check by a bug in that check itself, not a case this
// function is expected to handle correctly on its own.
export const resolveLandingPath = (roles: readonly string[]): string => {
  if (hasOperationalRole(roles)) return '/dashboard';
  if (roles.includes('auditor')) return '/audit';
  return '/dashboard';
};

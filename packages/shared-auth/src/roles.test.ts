import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '@azure/msal-browser';
import type { UserRole } from '@mat-inspect/shared-types';
import { getRolesFromAccount, hasAllowedRole } from './roles';

// Build a minimal AccountInfo. Only idTokenClaims.roles is read by the helpers.
const makeAccount = (claims?: Record<string, unknown>): AccountInfo =>
  ({
    homeAccountId: 'home',
    environment: 'login.microsoftonline.com',
    tenantId: 'tenant',
    username: 'user@sait.ca',
    localAccountId: 'local',
    ...(claims ? { idTokenClaims: claims } : {}),
  }) as AccountInfo;

// The two callers of hasAllowedRole pass different allowed sets. Cover both so the
// shared helper is exercised the way each app uses it.
const PWA_ROLES = ['operator', 'supervisor'] as const satisfies readonly UserRole[];
// The dashboard app-entry gate (apps/dashboard/src/lib/auth.ts ALLOWED_ROLES). Auditor is
// allowed in here (DEV-112); it is a per-page override, not this set, that keeps auditor off
// the write-adjacent dashboard/fleet pages (see OPERATIONAL_PAGE_ROLES below).
const DASHBOARD_ROLES = [
  'supervisor',
  'manager',
  'admin',
  'auditor',
] as const satisfies readonly UserRole[];
// A representative operational page's explicit AuthGuard override (dashboard/fleet page.tsx).
// Auditor is deliberately absent here even though it passes the app-entry gate above.
const OPERATIONAL_PAGE_ROLES = [
  'supervisor',
  'manager',
  'admin',
] as const satisfies readonly UserRole[];

describe('getRolesFromAccount', () => {
  it('returns [] for a null account', () => {
    expect(getRolesFromAccount(null)).toEqual([]);
  });

  it('returns [] when the account has no idTokenClaims', () => {
    expect(getRolesFromAccount(makeAccount())).toEqual([]);
  });

  it('returns [] when the roles claim is absent', () => {
    expect(getRolesFromAccount(makeAccount({ oid: 'user-1' }))).toEqual([]);
  });

  it('returns [] when the roles claim is not an array', () => {
    expect(getRolesFromAccount(makeAccount({ roles: 'manager' }))).toEqual([]);
  });

  it('returns the roles array when present', () => {
    expect(getRolesFromAccount(makeAccount({ roles: ['manager', 'operator'] }))).toEqual([
      'manager',
      'operator',
    ]);
  });
});

describe('hasAllowedRole', () => {
  it.each(['supervisor', 'manager', 'admin', 'auditor'])(
    'allows the %s role into the dashboard app',
    (role) => {
      expect(hasAllowedRole(makeAccount({ roles: [role] }), DASHBOARD_ROLES)).toBe(true);
    },
  );

  it('denies the operator role entry to the dashboard app', () => {
    expect(hasAllowedRole(makeAccount({ roles: ['operator'] }), DASHBOARD_ROLES)).toBe(false);
  });

  it.each(['supervisor', 'manager', 'admin'])(
    'allows the %s role on an operational page',
    (role) => {
      expect(hasAllowedRole(makeAccount({ roles: [role] }), OPERATIONAL_PAGE_ROLES)).toBe(true);
    },
  );

  it.each(['operator', 'auditor'])('denies the %s role on an operational page', (role) => {
    expect(hasAllowedRole(makeAccount({ roles: [role] }), OPERATIONAL_PAGE_ROLES)).toBe(false);
  });

  it.each(['operator', 'supervisor'])('allows the %s pwa role', (role) => {
    expect(hasAllowedRole(makeAccount({ roles: [role] }), PWA_ROLES)).toBe(true);
  });

  it.each(['manager', 'admin'])('denies the %s role on the pwa', (role) => {
    expect(hasAllowedRole(makeAccount({ roles: [role] }), PWA_ROLES)).toBe(false);
  });

  it('allows a user holding multiple roles where one is permitted', () => {
    expect(
      hasAllowedRole(makeAccount({ roles: ['operator', 'supervisor'] }), DASHBOARD_ROLES),
    ).toBe(true);
  });

  it('denies a user with an empty roles array', () => {
    expect(hasAllowedRole(makeAccount({ roles: [] }), DASHBOARD_ROLES)).toBe(false);
  });

  it('denies a null account', () => {
    expect(hasAllowedRole(null, DASHBOARD_ROLES)).toBe(false);
  });

  it('denies when the roles claim is missing', () => {
    expect(hasAllowedRole(makeAccount({ oid: 'user-1' }), DASHBOARD_ROLES)).toBe(false);
  });
});

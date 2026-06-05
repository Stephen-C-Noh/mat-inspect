import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '@azure/msal-browser';
import { getRolesFromAccount, hasAllowedRole } from './auth';

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
    expect(getRolesFromAccount(makeAccount({ roles: 'Manager' }))).toEqual([]);
  });

  it('returns the roles array when present', () => {
    expect(getRolesFromAccount(makeAccount({ roles: ['Manager', 'Operator'] }))).toEqual([
      'Manager',
      'Operator',
    ]);
  });
});

describe('hasAllowedRole', () => {
  it.each(['Supervisor', 'Manager', 'Admin'])('allows the %s role', (role) => {
    expect(hasAllowedRole(makeAccount({ roles: [role] }))).toBe(true);
  });

  it.each(['Operator', 'Auditor'])('denies the %s role', (role) => {
    expect(hasAllowedRole(makeAccount({ roles: [role] }))).toBe(false);
  });

  it('allows a user holding multiple roles where one is permitted', () => {
    expect(hasAllowedRole(makeAccount({ roles: ['Operator', 'Supervisor'] }))).toBe(true);
  });

  it('denies a user with an empty roles array', () => {
    expect(hasAllowedRole(makeAccount({ roles: [] }))).toBe(false);
  });

  it('denies a null account', () => {
    expect(hasAllowedRole(null)).toBe(false);
  });

  it('denies when the roles claim is missing', () => {
    expect(hasAllowedRole(makeAccount({ oid: 'user-1' }))).toBe(false);
  });
});

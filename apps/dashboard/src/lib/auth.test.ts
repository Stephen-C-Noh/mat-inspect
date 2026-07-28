import { describe, expect, it } from 'vitest';
import { ALLOWED_ROLES, OPERATIONAL_ROLES, hasOperationalRole, resolveLandingPath } from './auth';

// Imports the real constants rather than redeclaring role literals, so a change to
// OPERATIONAL_ROLES or ALLOWED_ROLES here is caught by these tests instead of silently
// leaving them untested (the gap flagged in DEV-112 review).

describe('hasOperationalRole', () => {
  it.each(OPERATIONAL_ROLES)('is true for %s', (role) => {
    expect(hasOperationalRole([role])).toBe(true);
  });

  it('is false for auditor alone', () => {
    expect(hasOperationalRole(['auditor'])).toBe(false);
  });

  it('is false for an empty roles array', () => {
    expect(hasOperationalRole([])).toBe(false);
  });

  it('is true when an operational role is held alongside others', () => {
    expect(hasOperationalRole(['auditor', 'supervisor'])).toBe(true);
  });
});

describe('resolveLandingPath', () => {
  it.each(OPERATIONAL_ROLES)('sends %s to /dashboard', (role) => {
    expect(resolveLandingPath([role])).toBe('/dashboard');
  });

  it('sends an auditor-only account to /audit', () => {
    expect(resolveLandingPath(['auditor'])).toBe('/audit');
  });

  it('prefers /dashboard when an account holds both an operational role and auditor', () => {
    expect(resolveLandingPath(['auditor', 'manager'])).toBe('/dashboard');
  });

  it('falls back to /dashboard for a role outside ALLOWED_ROLES (defense in depth only: the app-entry gate should have already rejected it)', () => {
    expect(resolveLandingPath(['operator'])).toBe('/dashboard');
  });

  it('ALLOWED_ROLES is exactly the operational roles plus auditor', () => {
    expect(ALLOWED_ROLES).toEqual([...OPERATIONAL_ROLES, 'auditor']);
  });
});

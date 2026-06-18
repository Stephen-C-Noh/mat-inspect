import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './db-errors.js';

describe('isUniqueViolation', () => {
  it('returns true for a Postgres unique-violation error (SQLSTATE 23505)', () => {
    // Shape mirrors what node-postgres throws on a unique-index conflict.
    expect(
      isUniqueViolation({ code: '23505', detail: 'Key (asset_tag)=(MAT-OC-001) exists.' }),
    ).toBe(true);
  });

  it('returns false for a different Postgres error code', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false); // foreign_key_violation
  });

  it('returns false for non-error and unshaped values', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
    expect(isUniqueViolation({ code: 23505 })).toBe(false); // numeric code, not a string
  });
});

import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { equipment, users } from '@mat-inspect/db';

// DEV-28: core-api reaches the Drizzle schema through the @mat-inspect/db package
// entry (emitted output), not a deep relative path into the db project. This test
// fails to resolve the import until db is a real workspace package, which is the
// same resolution a production build performs at runtime.
describe('@mat-inspect/db package entry', () => {
  it('exposes the equipment table', () => {
    expect(getTableName(equipment)).toBe('equipment');
  });

  it('exposes the users table', () => {
    expect(getTableName(users)).toBe('users');
  });
});

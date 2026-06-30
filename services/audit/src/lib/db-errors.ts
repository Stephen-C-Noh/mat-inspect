// Postgres surfaces a unique-constraint violation as SQLSTATE 23505. node-postgres attaches
// that SQLSTATE to the thrown error as a `code` string.
const UNIQUE_VIOLATION = '23505';

const hasStringCode = (err: unknown): err is { code: string } =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  typeof (err as { code: unknown }).code === 'string';

export const isUniqueViolation = (err: unknown): boolean =>
  hasStringCode(err) && err.code === UNIQUE_VIOLATION;

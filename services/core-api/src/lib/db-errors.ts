// Postgres surfaces a unique-constraint violation as SQLSTATE 23505. node-postgres
// attaches that SQLSTATE to the thrown error as a `code` string. Route handlers use this
// to turn a lost insert race into a deterministic problem+json instead of a raw 500.
const UNIQUE_VIOLATION = '23505';

// Narrow from unknown rather than casting: the catch binding is unknown under strict mode,
// and the error shape is external (the pg driver), so a Zod-style structural check is safest.
const hasStringCode = (err: unknown): err is { code: string } =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  typeof (err as { code: unknown }).code === 'string';

// True when the error is a Postgres unique-constraint violation (e.g. two concurrent inserts
// with the same asset tag, where the pre-check select passed for both before either committed).
export const isUniqueViolation = (err: unknown): boolean =>
  hasStringCode(err) && err.code === UNIQUE_VIOLATION;

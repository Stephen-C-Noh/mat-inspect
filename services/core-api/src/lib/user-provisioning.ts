import type { AuthUser } from '@mat-inspect/shared-auth-server';
import { logger } from './logger.js';

// Just-in-time provisioning of the users shadow table (DEV-124). users.id stores the Entra oid
// directly and inspections.operator_id (and other actor columns) are foreign keys to it, so a
// staff member signing in for the first time has no row and their first write would 500 on the
// FK. Nothing else on the request path creates the row: Entra owns identity and roles, this
// table is a local shadow of it. Provisioning it here, off the validated token, keeps real
// logins working with no manual seeding step.
//
// certifications and active stay at their column defaults ([] and true). The CSA cert-expiry
// rule that reads them is a separate concern (users.ts); submit does not gate on them today, so
// a first-sight operator is not silently granted anything a seeded one would not have.

// Provisioned ids seen by this process. The upsert is idempotent on its own (onConflictDoNothing),
// so this cache is only an optimization: it turns "one cheap write per request" into "one write
// per new user per process", then a no-op. Not shared across replicas, and it does not need to be:
// the DB conflict clause is the real guard.
const provisionedIds = new Set<string>();

// displayName is NOT NULL and is recorded onto inspections as the operator's name (submit.ts,
// OHS s.257), so prefer the token's `name` claim; fall back to the email, then the id, when the
// token omits it. The row is written once and not overwritten (see onConflictDoNothing below), so
// this is the operator's recorded name until an admin edits it.
const deriveDisplayName = (user: AuthUser): string => user.name || user.email || user.id;

// email is NOT NULL and UNIQUE. A dev token (and some Entra tokens) carry no upn/preferred_username,
// so req.user.email can be empty; fall back to an id-derived placeholder so two unnamed users never
// collide on the unique constraint.
const deriveEmail = (user: AuthUser): string => user.email || `${user.id}@placeholder.local`;

// Idempotent upsert. Inserts the row on first sight; an existing row (seeded, or provisioned by a
// concurrent request) is left untouched (DoNothing, not DoUpdate): a later login carrying a poorer
// token, e.g. a dev token with no name or email, must not overwrite a good seeded row with a
// placeholder. The trade-off is that a placeholder row is corrected by an admin edit, not by a
// subsequent login. Safe to call on every authenticated request.
export const provisionUser = async (user: AuthUser): Promise<void> => {
  // Imported lazily: the db barrel builds the Drizzle client from config() at module-eval time,
  // and this module is pulled in through the auth middleware, which tests import before they set
  // DATABASE_URL. Deferring to call time keeps that config() read at runtime, after boot.
  const { db, users } = await import('../db/index.js');
  await db
    .insert(users)
    .values({ id: user.id, displayName: deriveDisplayName(user), email: deriveEmail(user) })
    .onConflictDoNothing({ target: users.id });
};

// The cached entry point the auth chokepoint calls after a token verifies. Skips the write once the
// id has been provisioned in this process.
//
// Best-effort: this runs on every authenticated request, including routes that never touch the DB
// (the AI transcribe proxy). Provisioning is a side effect to keep the shadow table populated, not
// a gate on the request, so a failure is logged and swallowed rather than turned into a 5xx. A
// route that then writes a users foreign key (submit) still fails loudly on its own if the row is
// genuinely absent. The id is not cached on failure, so the next request retries.
export const ensureUserProvisioned = async (user: AuthUser): Promise<void> => {
  if (provisionedIds.has(user.id)) return;
  try {
    await provisionUser(user);
    provisionedIds.add(user.id);
  } catch (err) {
    logger.warn({ err, userId: user.id }, 'user provisioning failed');
  }
};

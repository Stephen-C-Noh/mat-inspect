import { pgTable, bigserial, timestamp, boolean, integer, text } from 'drizzle-orm/pg-core';

// One row per full-chain verification run (nightly, or manually triggered later). Separate from
// audit_events so a verification run is never mistaken for a chain event (ARCHITECTURE.md 8.4
// rule 7, DEV-40 AC2).
export const chainVerifications = pgTable('chain_verifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  ok: boolean('ok').notNull(),
  checked: integer('checked').notNull(),
  brokenAtSeq: integer('broken_at_seq'),
  reason: text('reason'),
  elapsedMs: integer('elapsed_ms').notNull(),
});

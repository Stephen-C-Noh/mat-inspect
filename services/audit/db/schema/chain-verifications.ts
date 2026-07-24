import { pgTable, bigserial, bigint, timestamp, boolean, integer, text } from 'drizzle-orm/pg-core';

// One row per full-chain verification run (nightly, or manually triggered later). Separate from
// audit_events so a verification run is never mistaken for a chain event (ARCHITECTURE.md 8.4
// rule 7, DEV-40 AC2).
export const chainVerifications = pgTable('chain_verifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  ok: boolean('ok').notNull(),
  // bigint, not integer: both count and reference audit_events.seq, which is bigserial (bigint).
  // An int4 column would raise "integer out of range" once seq passes 2^31-1, and it would fail
  // at exactly the moment a break must be recorded (broken_at_seq). mode:'number' keeps the JS
  // value a plain number, safe well past the capstone-scale row counts this table sees.
  checked: bigint('checked', { mode: 'number' }).notNull(),
  brokenAtSeq: bigint('broken_at_seq', { mode: 'number' }),
  reason: text('reason'),
  elapsedMs: integer('elapsed_ms').notNull(),
});

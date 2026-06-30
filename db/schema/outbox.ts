import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

// Transactional outbox (ADR 0008): a row here is inserted in the same core_db transaction
// as the Inspection it describes, so the two either both commit or neither does. The
// poller, hash chain, and content digest that read this table are DEV-23's scope; this
// table only needs to hold enough to identify what happened so DEV-23 can look the rest up.
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  // Null means undelivered. Set by the poller (DEV-23), not by this ticket.
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// ADR 0009: replaces the per-record HMAC as the idempotency binding. A row is inserted in
// the same transaction as the write it guards, so the work and its idempotency record
// always land together. requestDigest binds the key to one logical write: a repeat of the
// same key with a matching digest replays responseStatus/responseBody; a different digest
// is a client bug (IDEMPOTENCY_MISMATCH, 409).
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    // Scoped per operator so a client-generated key cannot collide across operators.
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => users.id),
    requestDigest: text('request_digest').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('idempotency_keys_operator_key').on(table.operatorId, table.key)],
);

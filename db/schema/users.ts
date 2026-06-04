import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

// Shadow table for Entra ID users. The id column holds the oid claim from the
// Entra ID JWT verbatim so foreign keys in other tables resolve without a lookup.
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

// Shadow table: id stores the Entra ID oid claim directly so FK joins need no extra lookup.
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

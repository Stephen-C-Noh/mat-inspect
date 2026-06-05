import { pgTable, uuid, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';

// Shadow table: id stores the Entra ID oid claim directly so FK joins need no extra lookup.
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull().unique(),
  // Certification expiry backs the CSA B167/B335 rule: expired operators are blocked
  // from submitting inspections for the class they are not currently certified for.
  certifications: jsonb('certifications')
    .$type<{ type: string; expiresAt: string }[]>()
    .notNull()
    .default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

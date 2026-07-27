import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { inspections } from './inspections.js';
import { users } from './users.js';

// Which inspection notifications a given manager has cleared from their bell (ADR 0026).
//
// This table is what lets the dashboard's activity feed avoid a cursor. A cursor, whether a
// timestamp or a sequence, is assigned when a row is inserted but only becomes visible when its
// transaction commits, and those two orders differ: an inspection stamped earlier can commit after
// a poll has already advanced past it, and is then never reported. Asking "which inspections have
// I not dismissed" has no such window. A late-committing row simply appears in the next answer.
//
// Unlike inspections and audit_events, rows here are not part of the compliance record: they say
// what a manager looked at, not what happened to a machine. Deleting one restores a notification;
// nothing about the inspection changes. Old rows are pruned with the feed's retention window.
export const notificationDismissals = pgTable(
  'notification_dismissals',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Dismissal is per manager, and the same manager dismissing twice is not an error: the pair is
    // the identity of the fact, and a repeat insert conflicts into a no-op.
    primaryKey({ columns: [table.userId, table.inspectionId] }),
  ],
);

import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { equipment } from './equipment.js';
import { inspections } from './inspections.js';
import { users } from './users.js';
import { failSeverityEnum } from './checklist-templates.js';

export const defectStatusEnum = pgEnum('defect_status', [
  'OPEN',
  'ACKNOWLEDGED',
  'IN_REPAIR',
  'RESOLVED',
  'REJECTED',
]);

// Opened from a failing checklist item on Inspection submit (ARCHITECTURE.md Section 6).
// A defect with severity BLOCKING and a status other than RESOLVED/REJECTED is "open
// blocking" and excludes the equipment from computed READY (ADR 0006).
export const defects = pgTable('defects', {
  id: uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .references(() => inspections.id),
  equipmentId: uuid('equipment_id')
    .notNull()
    .references(() => equipment.id),
  itemKey: text('item_key').notNull(),
  severity: failSeverityEnum('severity').notNull(),
  description: text('description').notNull(),
  photoIds: uuid('photo_ids').array().notNull().default([]),
  status: defectStatusEnum('status').notNull().default('OPEN'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolutionNotes: text('resolution_notes'),
  returnToServiceApprovedBy: uuid('return_to_service_approved_by').references(() => users.id),
});

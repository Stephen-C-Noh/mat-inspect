import { pgTable, uuid, integer, boolean, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { equipmentTypeEnum } from './equipment.js';
import { users } from './users.js';

export const checklistItemTypeEnum = pgEnum('checklist_item_type', [
  'BOOLEAN',
  'BOOLEAN_PHOTO_ON_FAIL',
  'MEASUREMENT',
  'TEXT',
  'SIGNATURE',
]);

export const failSeverityEnum = pgEnum('fail_severity', ['BLOCKING', 'WARNING']);

// Embedded in the items jsonb column; not a separate table (Section 6 of ARCHITECTURE.md).
export type ChecklistItemRecord = {
  key: string;
  prompt: string;
  type: (typeof checklistItemTypeEnum.enumValues)[number];
  required: boolean;
  failSeverity: (typeof failSeverityEnum.enumValues)[number];
  regulatoryReference?: string;
};

export const checklistTemplates = pgTable('checklist_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  equipmentType: equipmentTypeEnum('equipment_type').notNull(),
  version: integer('version').notNull(),
  // Exactly one active row per equipment_type; enforced by the publish transaction
  // (services/core-api/src/routes/checklists/publish.ts), not a DB constraint, so a
  // version can be re-activated later without violating uniqueness on insert.
  isActive: boolean('is_active').notNull().default(false),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  items: jsonb('items').$type<ChecklistItemRecord[]>().notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

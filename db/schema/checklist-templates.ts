import {
  pgTable,
  uuid,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

export const checklistTemplates = pgTable(
  'checklist_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentType: equipmentTypeEnum('equipment_type').notNull(),
    version: integer('version').notNull(),
    // Exactly one active row per equipment_type: enforced by the
    // checklist_templates_one_active_per_type partial unique index below, not just
    // the publish transaction (services/core-api/src/routes/checklists/publish.ts).
    // Re-activating an old version is still fine: within one transaction, the
    // currently-active row is flipped to false before the target row is flipped to
    // true, so the index never sees two active rows at once.
    isActive: boolean('is_active').notNull().default(false),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    items: jsonb('items').$type<ChecklistItemRecord[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('checklist_templates_one_active_per_type')
      .on(table.equipmentType)
      .where(sql`${table.isActive} = true`),
    uniqueIndex('checklist_templates_type_version').on(table.equipmentType, table.version),
  ],
);

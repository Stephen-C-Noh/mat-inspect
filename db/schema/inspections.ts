import {
  pgTable,
  uuid,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { equipment } from './equipment.js';
import { users } from './users.js';
import { checklistTemplates } from './checklist-templates.js';

export const inspectionResultEnum = pgEnum('inspection_result', [
  'PASS',
  'FAIL_WARNING',
  'FAIL_BLOCKING',
]);

export const notesSourceEnum = pgEnum('notes_source', [
  'TYPED',
  'VOICE_TRANSCRIBED',
  'VOICE_EDITED',
]);

// Immutable once written: UPDATE/DELETE-blocking triggers added in the
// inspection_immutability_triggers migration (ADR 0008). Corrections are new linked
// inspections, not edits.
export const inspections = pgTable(
  'inspections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id),
    // Attestation is operatorId + submittedAt + the confirmed submit; no signature column
    // (ADR 0007). operatorId always comes from the validated token, never the request body.
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => users.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => checklistTemplates.id),
    // Pinned at submit time so a later template republish does not change what an existing
    // Inspection is read as having been graded against.
    templateVersion: integer('template_version').notNull(),
    result: inspectionResultEnum('result').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Supports the readiness passing-today query: WHERE equipment_id = ? AND result = 'PASS'
    // AND submitted_at >= readiness_baseline_at AND submitted_at::date = today (ADR 0006).
    index('inspections_equipment_result_submitted_idx').on(
      table.equipmentId,
      table.result,
      table.submittedAt,
    ),
  ],
);

// Immutable once written: see inspections above.
export const inspectionResponses = pgTable('inspection_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .references(() => inspections.id),
  itemKey: text('item_key').notNull(),
  value: jsonb('value').notNull(),
  passed: boolean('passed').notNull(),
  notes: text('notes'),
  notesSource: notesSourceEnum('notes_source'),
  // Per-response references to Media blobs (photo evidence for this checklist item; ADR 0023).
  // Set once at INSERT; the UPDATE/DELETE-blocking trigger above keeps them immutable. Sealed
  // into the inspection content hash, so a swapped or removed reference is tamper-evident.
  photoIds: uuid('photo_ids').array().notNull().default([]),
});

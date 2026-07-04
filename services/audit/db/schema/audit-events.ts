import { pgTable, bigserial, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const auditActionEnum = pgEnum('audit_action', [
  'INSPECTION_SUBMITTED',
  'DEFECT_OPENED',
  'DEFECT_RESOLVED',
  'EQUIPMENT_STATUS_CHANGED',
]);

// Append-only hash chain (ADR 0008; ARCHITECTURE.md 8.4). Only the Audit Service has INSERT on
// this table (audit_writer role, INSERT+SELECT only; see infra/docker/postgres-init.sh); UPDATE
// and DELETE are never granted, so there is no defense-in-depth trigger to add here the way
// inspections/inspection_responses needed one (those tables are owned by a role that could
// otherwise UPDATE them).
//
// Three identity-shaped columns, not one, because the conceptual "id (uuid, monotonic)" from
// ARCHITECTURE.md's data model can't actually be a single column: the redelivery dedup key is
// inherited from core_db's outbox.id, which is gen_random_uuid() (UUIDv4, not sortable).
//   - seq:             real insertion order; used to find the chain tail and to walk the chain.
//   - id:               the event's own identity; part of the hash input.
//   - source_event_id:  the outbox row's id; the dedup key ("the chain deduplicates by event id").
export const auditEvents = pgTable('audit_events', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  id: uuid('id').notNull().unique().defaultRandom(),
  sourceEventId: uuid('source_event_id').notNull().unique(),
  prevHash: text('prev_hash').notNull(),
  thisHash: text('this_hash').notNull(),
  // Hashed as toCanonicalTimestamp(occurredAt) (ARCHITECTURE.md 8.4 rule 4: UTC, ISO 8601,
  // microsecond-padded, generated once and never recomputed differently).
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  actorId: uuid('actor_id').notNull(),
  action: auditActionEnum('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(),
  // Flat scalar values only (string | number | boolean | null), enforced by
  // auditEventIngestSchema: a hash is not PII (ADR 0008), so this carries ids, enums, and
  // digests, never free text.
  payloadSummary: jsonb('payload_summary').notNull(),
  // Ops/debug only; excluded from the hash input (rule 3 enumerates the input fields exactly,
  // and created_at is not one of them).
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

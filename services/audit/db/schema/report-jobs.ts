import { pgTable, uuid, text, integer, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import type { ReportFilters, ReportExportOptions } from '@mat-inspect/shared-schemas';

export const reportFormatEnum = pgEnum('report_format', ['PDF', 'CSV']);

export const reportJobStatusEnum = pgEnum('report_job_status', ['PROCESSING', 'READY', 'FAILED']);

// Tracks an export job end to end (DEV-38). Unlike audit_events, this table is mutable by design
// (PROCESSING -> READY|FAILED), so it does NOT get the UPDATE/DELETE-blocking treatment
// audit_events has; it carries no evidentiary weight of its own, it just tracks a background job.
// audit_writer's blanket ALTER DEFAULT PRIVILEGES (infra/docker/postgres-init.sh) only grants
// SELECT+INSERT, deliberately, so audit_events stays append-only by default for every future
// table too; this table gets an explicit, table-scoped GRANT UPDATE in its migration instead of
// loosening that default (see the generated migration SQL).
export const reportJobs = pgTable('report_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // The Entra oid of whoever called POST /reports/export. No FK: audit_db has no users table
  // (ADR 0001, services own their data), so this is an opaque id, resolved to a display name (if
  // ever needed) by whoever reads it, not by a join here.
  requestedBy: uuid('requested_by').notNull(),
  format: reportFormatEnum('format').notNull(),
  filters: jsonb('filters').$type<ReportFilters>().notNull(),
  options: jsonb('options').$type<ReportExportOptions>().notNull(),
  status: reportJobStatusEnum('status').notNull().default('PROCESSING'),
  inspectionCount: integer('inspection_count'),
  fileBytes: integer('file_bytes'),
  sha256: text('sha256'),
  // Base64 RSA signature over the file's sha256 digest (ADR 0022), and a fingerprint of the
  // public key that verifies it, for display. Both null until the job reaches READY.
  signature: text('signature'),
  signingKeyFingerprint: text('signing_key_fingerprint'),
  blobName: text('blob_name'),
  // Generic on purpose: the real error is logged server-side via Pino, never reflected to the
  // client (CLAUDE.md logging rules; this column is read back over the API).
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readyAt: timestamp('ready_at', { withTimezone: true }),
});

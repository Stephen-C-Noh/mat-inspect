CREATE TYPE "public"."report_format" AS ENUM('PDF', 'CSV');--> statement-breakpoint
CREATE TYPE "public"."report_job_status" AS ENUM('PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "report_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"format" "report_format" NOT NULL,
	"filters" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"status" "report_job_status" DEFAULT 'PROCESSING' NOT NULL,
	"inspection_count" integer,
	"file_bytes" integer,
	"sha256" text,
	"signature" text,
	"signing_key_fingerprint" text,
	"blob_name" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone
);
--> statement-breakpoint
-- Belt-and-suspenders alongside infra/docker/postgres-init.sh, same as audit_events' grant in
-- 0000: makes the table usable immediately in an environment that didn't pre-seed default
-- privileges (e.g. testcontainers).
--
-- UPDATE is granted here, table-scoped, rather than by widening the ALTER DEFAULT PRIVILEGES in
-- postgres-init.sh. That default deliberately grants SELECT+INSERT only, so audit_events (and
-- every future table) stays append-only unless a migration explicitly says otherwise. report_jobs
-- is a mutable job-status table (PROCESSING -> READY|FAILED), not an evidentiary record, so it
-- is the explicit otherwise (DEV-38; see ADR referenced in db/schema/report-jobs.ts).
GRANT SELECT, INSERT, UPDATE ON "report_jobs" TO audit_writer;

CREATE TYPE "public"."audit_action" AS ENUM('INSPECTION_SUBMITTED', 'DEFECT_OPENED', 'DEFECT_RESOLVED', 'EQUIPMENT_STATUS_CHANGED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"source_event_id" uuid NOT NULL,
	"prev_hash" text NOT NULL,
	"this_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"payload_summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_id_unique" UNIQUE("id"),
	CONSTRAINT "audit_events_source_event_id_unique" UNIQUE("source_event_id")
);
--> statement-breakpoint
-- Belt-and-suspenders alongside the ALTER DEFAULT PRIVILEGES grant in
-- infra/docker/postgres-init.sh: makes the table usable immediately even in a test environment
-- that didn't pre-seed default privileges (e.g. testcontainers, which bootstraps roles itself).
-- INSERT + SELECT only; UPDATE and DELETE are never granted (DEV-23 acceptance criteria).
GRANT SELECT, INSERT ON "audit_events" TO audit_writer;
-- bigserial creates an underlying sequence; audit_writer needs USAGE to call nextval() on INSERT.
GRANT USAGE, SELECT ON SEQUENCE "audit_events_seq_seq" TO audit_writer;

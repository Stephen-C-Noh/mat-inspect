CREATE TABLE "chain_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"checked" integer NOT NULL,
	"broken_at_seq" integer,
	"reason" text,
	"elapsed_ms" integer NOT NULL
);
--> statement-breakpoint
-- Belt-and-suspenders alongside the ALTER DEFAULT PRIVILEGES grant in
-- infra/docker/postgres-init.sh (see 0000_nasty_overlord.sql for the same pattern on
-- audit_events): makes the table usable immediately even where default privileges weren't
-- pre-seeded (e.g. testcontainers). INSERT + SELECT only; this table is append-only too.
GRANT SELECT, INSERT ON "chain_verifications" TO audit_writer;
GRANT USAGE, SELECT ON SEQUENCE "chain_verifications_id_seq" TO audit_writer;

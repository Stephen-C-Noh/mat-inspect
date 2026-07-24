-- Custom SQL migration file, put your code below! --
-- Defense-in-depth for the hash chain (ARCHITECTURE.md 8.4 rule 6, DEV-40). Format-only: does
-- NOT recompute the hash. A PL/pgSQL RFC 8785 canonicalizer risks diverging from the Node
-- `canonicalize` library (ARCHITECTURE.md 8.4 rule 6's own implementation note); this only
-- rejects a structurally malformed hash before it reaches verifyChain().
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_prev_hash_format" CHECK (prev_hash ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_this_hash_format" CHECK (this_hash ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
-- Immutability trigger, mirroring db/migrations/0004_inspection_immutability_triggers.sql.
-- audit_writer's GRANT already blocks UPDATE/DELETE (roles.integration.test.ts); this is
-- defense-in-depth against a future grant mistake. UPDATE and DELETE are row-level; TRUNCATE
-- is a separate command that row-level triggers do not fire on (it would wipe the whole chain
-- without tripping the DELETE trigger), so it gets its own statement-level trigger below.
CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; UPDATE, DELETE, and TRUNCATE are never valid';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
--> statement-breakpoint
-- TRUNCATE triggers must be FOR EACH STATEMENT (row-level is not allowed for TRUNCATE). This
-- closes the hole the row-level triggers leave: a TRUNCATE (or a future grant mistake handing it
-- to a non-owner) would otherwise empty the append-only chain without firing any trigger.
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();
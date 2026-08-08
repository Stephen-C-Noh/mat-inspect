-- Custom SQL migration file, put your code below! --
-- DEV-146 AC2. outbox had no trigger at all: the "only processed_at is ever updated, payload is
-- never touched" rule (db/schema/outbox.ts) was a pure application-code convention, not enforced
-- by Postgres. Mirrors db/migrations/0004_inspection_immutability_triggers.sql and
-- services/audit/db/migrations/0001_audit_events_hash_format_and_immutability.sql, except outbox
-- has one legitimate mutation (the poller's processed_at write in
-- services/core-api/src/outbox/poller.ts) so the UPDATE trigger allows that column through and
-- rejects everything else, instead of rejecting UPDATE outright.
CREATE FUNCTION reject_outbox_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'outbox rows are immutable except processed_at';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER outbox_no_mutate
  BEFORE UPDATE ON "outbox"
  FOR EACH ROW EXECUTE FUNCTION reject_outbox_mutation();
--> statement-breakpoint
CREATE FUNCTION reject_outbox_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'outbox rows are immutable and cannot be deleted or truncated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER outbox_no_delete
  BEFORE DELETE ON "outbox"
  FOR EACH ROW EXECUTE FUNCTION reject_outbox_delete();
--> statement-breakpoint
-- TRUNCATE is a separate command that row-level triggers do not fire on (same reasoning as
-- audit_events_no_truncate); without this it would empty the outbox unnoticed.
CREATE TRIGGER outbox_no_truncate
  BEFORE TRUNCATE ON "outbox"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_outbox_delete();

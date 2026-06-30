-- Custom SQL migration file, put your code below! --
-- Defense-in-depth for inspection immutability (ADR 0008). Corrections are new linked
-- inspections, never edits, so any UPDATE or DELETE on these tables is a bug or tampering,
-- not a valid operation.
CREATE FUNCTION reject_inspection_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inspections and inspection_responses are immutable; corrections are new linked inspections';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspections_no_update
  BEFORE UPDATE ON "inspections"
  FOR EACH ROW EXECUTE FUNCTION reject_inspection_mutation();
--> statement-breakpoint
CREATE TRIGGER inspections_no_delete
  BEFORE DELETE ON "inspections"
  FOR EACH ROW EXECUTE FUNCTION reject_inspection_mutation();
--> statement-breakpoint
CREATE TRIGGER inspection_responses_no_update
  BEFORE UPDATE ON "inspection_responses"
  FOR EACH ROW EXECUTE FUNCTION reject_inspection_mutation();
--> statement-breakpoint
CREATE TRIGGER inspection_responses_no_delete
  BEFORE DELETE ON "inspection_responses"
  FOR EACH ROW EXECUTE FUNCTION reject_inspection_mutation();

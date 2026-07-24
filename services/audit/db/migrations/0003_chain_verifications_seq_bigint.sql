-- checked and broken_at_seq store / count audit_events.seq (bigserial). int4 would overflow past
-- 2^31-1, failing exactly when a break must be recorded. Widen to bigint (DEV-40 review follow-up).
ALTER TABLE "chain_verifications" ALTER COLUMN "checked" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "chain_verifications" ALTER COLUMN "broken_at_seq" SET DATA TYPE bigint;
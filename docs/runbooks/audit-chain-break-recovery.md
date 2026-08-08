# Runbook: audit chain break recovery

This runbook covers DEV-145: what to do when the Audit Service detects a break in the
`audit_events` hash chain. It implements ARCHITECTURE.md 8.4 rule 7 ("any break triggers a
CRITICAL alert to Admin and freezes new writes until manual review"). This document is the
manual review procedure that rule refers to.

Scope: recovery only. This runbook does not cover how to deliberately reproduce a chain break
for testing; it assumes a break has already been detected in a running environment.

---

## 1. Read this first: inspections are not blocked

A frozen or down Audit Service does not stop operators from working. `routes/inspections/submit.ts`
writes the inspection, its responses, and an outbox row in one `core_db` transaction; audit delivery
is asynchronous. With the Audit Service unreachable, `services/core-api/src/outbox/poller.ts` retries
delivery every tick indefinitely (no retry cap, no dead-letter queue) and just logs a warning.

Still working during the outage: inspection submit, equipment lockout, defect creation, supervisor
notifications, computed readiness.

Not working: report export and download (Audit Service is down or refusing writes), and sealing of
new audit events (they queue in `core_db.outbox` with `processed_at` still `NULL`).

Do not treat this as an inspection-stoppage incident. Triage it as an audit/compliance incident:
report generation and evidentiary sealing are degraded, not the operator-facing system.

---

## 2. How a break is detected

There are two independent paths. Both call the same check (`verifyChainSegment` in
`services/audit/src/lib/chain.ts`), which walks `audit_events` from genesis, recomputes each row's
`this_hash`, and confirms it both matches the stored value and chains to the previous row's
`this_hash`.

### 2.1 Startup verification (the service will not come up)

`services/audit/src/server.ts` runs `verifyChain()` before `app.listen()`. On failure it logs a
`fatal` line and calls `process.exit(1)`. Under `restart: unless-stopped` in `docker-compose.yml`,
Docker restarts the container, which runs the same check and exits again: a crash loop. `docker ps`
shows the `audit` service cycling through `Restarting`.

Find the details in the container's last log lines before an exit:

```
docker compose logs audit --tail 200 | grep -A5 'audit chain verification failed'
```

The fatal log line carries three fields:

- `brokenAtSeq`: the `seq` of the first row that failed verification.
- `reason`: either a `prev_hash mismatch at seq N` (chain link broken) or `this_hash at seq N does
  not match the recomputed hash` (a row's own content was altered after insert).
- `checked`: how many rows verified clean before the break (rows `0..checked-1` are still
  trustworthy).

### 2.2 Nightly verification (the service is up, writes are frozen)

If the break is not present at startup but appears later (for example, a corrupting event lands
after boot), `services/audit/src/lib/nightly-verify.ts` finds it on its scheduled run. It does not
crash the process: it logs an `error` line with the same `brokenAtSeq`/`reason`/`checked` fields, then
calls `freezeWrites(reason)`.

`freezeWrites` sets an in-memory flag only (`services/audit/src/lib/chain.ts`). While set,
`appendAuditEvent` throws a `503 CHAIN_FROZEN` for every call, so the outbox poller's deliveries start
failing and queuing. There is no unfreeze endpoint. A restart clears the flag, but startup
verification runs immediately after and finds the same break, so the service falls into the same
crash loop as 2.1. **A plain restart is not a fix**; it only converts a live-frozen service into a
dead one.

Query the same signal from the database instead of logs if needed — every run, pass or fail, is
recorded:

```sql
SELECT ok, checked, broken_at_seq, reason, ran_at
FROM chain_verifications
ORDER BY ran_at DESC
LIMIT 5;
```

---

## 3. Triage the cause before restoring anything

Restoring `audit_db` is destructive to rows written since the last good dump. Spend a few minutes
narrowing the cause first; it changes what you do next.

| Cause | How to recognize it | What it means for recovery |
| --- | --- | --- |
| **Tampering** | A row's stored fields (outside the hash-input set) look edited, or `this_hash` mismatches with no plausible operational explanation. Check `docker compose logs postgres` and any host access logs around the time the break was introduced. | Treat as a security incident, not routine ops. Preserve the broken database (do not restore over it yet) for later investigation. Escalate before restoring. |
| **Restore artifact** | A restore or migration ran recently (`chain_verifications` history, deploy logs, or `infra/backup/pg-backup.sh` schedule) shortly before the break appeared. | Most common cause in this project's own restore drills. Go to section 4; the fix is usually the `processedAt` reset in section 5, not a second restore. |
| **Migration** | A schema migration on `audit_events` ran around the break time. Rule 8 (ARCHITECTURE.md 8.4) requires the `audit_migrator` role and out-of-band approval for exactly this reason — a migration is the one path allowed to touch chain rows outside normal INSERT. | Check whether the migration altered any hash-input column (`id`, `timestamp`, `actor_id`, `action`, `resource_type`, `resource_id`, `payload_summary`, `prev_hash`). If so, the migration itself is the bug; fix it and treat the affected range as needing a fresh restore from before the migration ran. |
| **Hash-input bug** | Break appears right after a code deploy that touched `chain.ts`, the outbox `buildIngestBody` in `services/core-api/src/outbox/poller.ts`, or `@mat-inspect/shared-crypto`. Every row after the deploy fails, not just one. | This is an application bug, not a data problem. Restoring `audit_db` does not fix it: the next write reproduces the same break. Roll back the deploy first, then restore only if rows written by the buggy code need to be discarded. |

If you cannot tell which of these it is, default to treating it as tampering (the most conservative
assumption) and escalate before touching the database.

---

## 4. Restore `audit_db`

This follows the same restore mechanics as `docs/runbooks/backup-and-restore.md` section 3.2,
scoped to `audit_db` only. Do this on dev staging exactly as written; the same steps apply to a
future production Azure-hosted `audit_db`, substituting the managed restore mechanism (ADR 0005) for
`pg_restore`.

1. Stop the Audit Service so nothing tries to boot against a half-restored database:
   ```
   docker compose stop audit
   ```
2. Pick the most recent dump taken **before** the break was introduced. If section 3 pointed at a
   specific bad deploy or migration time, use the newest dump older than that time, not simply the
   newest dump on disk.
   ```
   docker compose exec -T db-backup sh -c 'ls -t /backups/audit_db_*.dump | head -5'
   ```
3. Restore over the live `audit_db` (destructive: this replaces every row written since the dump):
   ```
   docker compose exec -T postgres pg_restore --no-owner --clean --if-exists \
     -U "$POSTGRES_USER" -d audit_db /path/to/audit_db_<timestamp>.dump
   ```
   `audit_db` rows are append-only in normal operation; the immutability triggers allow this because
   a restore loads rows with `COPY`/`INSERT`, which the triggers permit (only `UPDATE`/`DELETE` are
   blocked).
4. Confirm the restored chain actually verifies before restarting the service:
   ```
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d audit_db \
     -c "SELECT count(*) FROM audit_events;"
   ```
   If you have a way to run `verifyChainSegment` standalone against the restored database (a
   throwaway `node -e` script importing `services/audit/src/lib/chain.ts` with `DATABASE_URL`
   pointed at `audit_db`), run it before starting the service. This catches a bad dump before it
   causes a second crash loop.
5. **Do not start the Audit Service yet.** Go to section 5 first — the outbox reset needs the
   restored database's own data, and doing it after the service is back up risks the poller
   redelivering into a still-inconsistent state.

---

## 5. Reset `outbox.processed_at` (the step that is easy to skip)

This is the trap the ticket exists to document. Skipping it silently loses events; the chain will
verify clean but have a permanent hole with no error anywhere.

### Why this step exists

`core_db.outbox` tracks delivery with `processed_at`: `NULL` means undelivered, a timestamp means the
Audit Service accepted it. The restore in section 4 rolled `audit_db` back to an earlier point. Every
outbox row whose event was delivered *after* that point still has `processed_at` set in `core_db`
(which was not restored), but the event it describes no longer exists in the restored `audit_db`.
The poller only picks up rows where `processed_at IS NULL` (`runOutboxPollTick` in
`services/core-api/src/outbox/poller.ts`), so those rows will never be resent unless this is reset by
hand.

Redelivery is safe to over-do: `appendAuditEvent` dedupes on `sourceEventId` (the outbox row's own
`id`), so resetting a row that was in fact still present in the restore is a harmless no-op resend.
Under-resetting is the dangerous direction — it is the one that loses events with no visible error.
When in doubt, widen the window rather than narrow it.

### Find the actual restore point

Do not trust the dump filename's timestamp alone as the cutoff; read it back from the data that was
actually restored, since `pg_dump` runs inside a single snapshot but you want the newest event that
made it into that snapshot:

```sql
-- run against the just-restored audit_db
SELECT max(occurred_at) AS restore_point FROM audit_events;
```

### Reset the affected outbox rows

Run this against `core_db`, using the `restore_point` from above. Subtracting a small safety margin
(shown as 5 minutes below) is deliberate slack for clock skew between the dump snapshot and event
`occurred_at`; widening it further is still safe per the over-reset guarantee above.

```sql
UPDATE outbox
SET processed_at = NULL
WHERE processed_at IS NOT NULL
  AND created_at > (TIMESTAMP '<restore_point>' - INTERVAL '5 minutes');
```

Check how many rows this affects before and after, so the number is in the incident record:

```sql
SELECT count(*) FROM outbox
WHERE processed_at IS NOT NULL
  AND created_at > (TIMESTAMP '<restore_point>' - INTERVAL '5 minutes');
```

---

## 6. Bring the service back and verify

1. Start the Audit Service:
   ```
   docker compose start audit
   ```
2. Confirm it actually comes up (does not crash loop):
   ```
   docker compose logs audit --tail 50 | grep 'audit chain verified on startup'
   ```
3. Confirm the outbox is draining, not just retrying the same failures:
   ```sql
   SELECT count(*) FROM outbox WHERE processed_at IS NULL;
   ```
   Watch this drop over the next few poll intervals (`outboxPollIntervalMs` in
   `services/core-api/src/lib/config.ts`). A count that stays flat or grows means delivery is still
   failing; check `docker compose logs core-api` for `outbox delivery rejected` or `outbox delivery
   failed` warnings.
4. Spot-check that a previously-queued event actually made it into the chain, using the
   `resource_id` of one of the affected outbox rows:
   ```sql
   SELECT seq, action, resource_id, occurred_at FROM audit_events
   WHERE resource_id = '<id from an affected outbox row>';
   ```

---

## 7. Record the incident

Log what happened the same way the DR drill does (`docs/runbooks/backup-and-restore.md` section
3.3): date, which dump was restored, the triage cause from section 3, how many outbox rows were
reset, and total time from detection to a clean `count(*) FROM outbox WHERE processed_at IS NULL`
draining to zero.

| Date | Ticket | Cause (section 3) | Dump restored | Outbox rows reset | Time to recovery | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| _(fill in on first real drill)_ | | | | | | |

---

## 8. Out of scope

A quarantine mode — refuse new writes but keep serving exports of the cryptographically verified
prefix up to `brokenAtSeq`, labelled as ending at that sequence, instead of the whole service going
dark — would shorten the outage in section 1 for report export specifically. It is a design change
to a compliance-critical service (an export endpoint would need to distinguish "verified" from
"unverified but present" data) and needs its own ADR and two reviewers. This runbook does not
implement it; raise it separately if the team decides the export downtime is worth solving.

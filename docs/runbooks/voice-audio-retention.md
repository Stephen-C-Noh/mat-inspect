# Runbook: raw voice-audio retention

This runbook covers the DEV-41 retention job: the daily purge of raw voice audio on dev staging,
what it deletes and keeps, how to configure and trigger it, and how the same policy is enforced on
production. It implements the retention policy in ARCHITECTURE.md section 8.4 and ADR 0004.

The policy has two halves, on two clocks:

| Data                                   | Retention | Enforced by                                             |
| -------------------------------------- | --------- | ------------------------------------------------------- |
| Raw voice audio (biometric PII, FOIP)  | 90 days   | This job on dev staging; Azure lifecycle policy on prod |
| Transcript text and inspection records | 7 years   | Not deleting them; the tables are immutable (ADR 0008)  |

The job deletes only the raw audio clip from Blob Storage. The transcript already lives in the
`InspectionResponse` row and stays. Inspection, response, and audit rows are never touched: the job
opens no database connection.

---

## 1. Dev staging: daily purge

### What runs

The `voice-retention` service in `docker-compose.yml` runs one purge a day. It reuses the built
`media` image, because the purge job ships inside it (`services/media/dist/jobs/purge-voice-audio.js`).
The service overrides the image entrypoint with the scheduler (`infra/retention/voice-retention-scheduler.sh`),
a poll loop with the same shape as the `db-backup` scheduler. It runs no HTTP server.

Each run (`purgeExpiredVoiceAudio` in `services/media/src/lib/voice-retention.ts`):

1. Computes the cutoff: `now` minus the retention window (90 days by default).
2. Lists blobs in the voice container (`mat-inspect-voice`, ADR 0004).
3. Deletes each clip whose Blob Storage creation time is before the cutoff.
4. Logs a summary and the id of every purged clip.

A clip created exactly at the cutoff is kept: "older than 90 days" is strict. A clip whose creation
time cannot be read is kept, so the job never deletes a blob whose age it cannot establish.

### What it keeps

The job deletes the raw audio object only. It does not read, write, or delete:

- the transcript text (in the `InspectionResponse` row),
- the inspection, response, or audit rows (immutable; the job holds no database connection),
- photos or PDF reports (separate containers, ADR 0004).

### Configuration

All optional. The defaults work with no `.env` changes.

| Variable                     | Default             | Meaning                                                                        |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `VOICE_RETENTION_TIME`       | `03:30`             | Time of day the purge runs. Runs after the 02:00 db backup. See timezone note. |
| `MEDIA_VOICE_RETENTION_DAYS` | `90`                | Clips older than this many days are purged. Matches ARCHITECTURE.md 8.4.       |
| `RETENTION_RUN_ON_START`     | `true`              | Run one purge when the service starts, so a deploy reconciles retention.       |
| `VOICE_RETENTION_DRY_RUN`    | `false`             | Report what would be purged without deleting. See section 4.                   |
| `MEDIA_VOICE_BLOB_CONTAINER` | `mat-inspect-voice` | The voice-clip container to purge.                                             |

A non-positive `MEDIA_VOICE_RETENTION_DAYS` is rejected at boot: a zero or negative window would
purge audio still inside the 90-day window.

Timezone: `VOICE_RETENTION_TIME` is read in the container's local time. The container has no timezone
set, so that is UTC. `03:30` means 03:30 UTC. To run at 03:30 in the host's local time, set `TZ` on
the `voice-retention` service (for example `TZ: America/Edmonton`).

### Trigger a purge by hand

```
docker compose exec voice-retention node /repo/services/media/dist/jobs/purge-voice-audio.js
```

The job is idempotent, so running it by hand between scheduled runs is safe: it deletes only clips
already past the window and skips clips already gone.

### See what was purged

The scheduler and the job log to the container's stdout. Read it with:

```
docker compose logs voice-retention
```

Each purged clip logs one line with its `voiceClipId` (a UUID, the same value as the response's
`voice_clip_id`). The end-of-run line reports `scanned`, `purged`, and `failed` counts. No transcript,
audio, operator name, or other PII is ever logged (CLAUDE.md section 4).

### Health

The compose healthcheck reads a heartbeat file the scheduler touches every 30 seconds. If the file
is older than two minutes the loop is wedged and the service reports unhealthy. The check proves the
scheduler is alive, not that a purge is fresh: a daily job is idle most of the day, so purge freshness
is the wrong liveness signal.

```
docker compose ps voice-retention
```

---

## 2. Why the job cannot delete a record

Two properties guarantee it:

1. The `voice-retention` service has no `DATABASE_URL` and does not depend on `postgres`. There is no
   connection through which it could issue SQL.
2. The `inspections`, `inspection_responses`, and `audit_events` tables reject UPDATE and DELETE with
   database triggers (ADR 0008). Even a future mistake that gave the job a connection could not delete
   a row.

The `retention.test.ts` wiring test asserts the first property; the append-only migration tests assert
the second.

---

## 3. Idempotency

The purge uses `deleteIfExists`. A second run (or a concurrent run) that finds a clip already deleted
is a no-op, not an error. A missed run (the container was down at the scheduled time) is harmless: the
next run deletes everything then past the window. `RETENTION_RUN_ON_START` gives one purge on every
deploy regardless.

---

## 4. First deploy: dry run

Before enabling real deletion on a new box, confirm the container name and window with a dry run. Set
`VOICE_RETENTION_DRY_RUN=true` in `.env` and start the service, or run the job by hand:

```
docker compose exec -e RETENTION_DRY_RUN=true voice-retention \
  node /repo/services/media/dist/jobs/purge-voice-audio.js
```

The job logs every clip it would purge, with counts, and deletes nothing. Clear the flag once the
output looks right.

---

## 5. Production: Azure Storage lifecycle policy

Production does not run this service. There the 90-day purge is a lifecycle-management rule on the
`mat-inspect-voice` container in the Azure Storage account (ADR 0004), the same way the 7-day backup
window is managed by Azure in prod (see the database backup runbook). The rule deletes a blob 90 days
after its creation.

Production is not provisioned during the capstone (ADR 0016). The Azure lifecycle rule is set once
Azure prod exists; it is not configured now.

---

## 6. What this job does not do

- It does not transcribe or read audio. It deletes objects by age.
- It does not delete photos or PDF reports. Those live in other containers with their own retention.
- It does not delete any database row. See section 2.

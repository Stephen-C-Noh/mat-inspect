# Operations Runbook: Day-Two MAT-Inspect

This doc is for whoever operates a running MAT-Inspect deployment day to day: a future SAIT
operational owner, not the capstone team. It assumes the stack is already up, following
[DEPLOYMENT.md](DEPLOYMENT.md). It does not repeat how to stand the stack up; it covers what
to check when something looks wrong, how to read the logs, how to restart safely, the
backup and restore procedure, and what this system must never be made to do.

Read the two invariants in section 1 before anything else in this doc. They are not
troubleshooting steps; they are the boundary this system cannot cross without breaking the
compliance record it exists to produce.

---

## 1. What must never be done

### 1.1 Never UPDATE or DELETE inspections, inspection_responses, or audit_events

These three tables are append-only by design (ADR 0007, ADR 0008), and it is enforced in
the database, not just in application code:

- `db/migrations/0004_inspection_immutability_triggers.sql` attaches
  `reject_inspection_mutation()` as a `BEFORE UPDATE` and `BEFORE DELETE` trigger on
  `inspections` and `inspection_responses`. Either statement raises a Postgres exception
  before it can touch a row.
- `services/audit/db/migrations/0001_audit_events_hash_format_and_immutability.sql` does the
  same for `audit_events`, plus a statement-level `BEFORE TRUNCATE` trigger, because
  `TRUNCATE` does not fire row-level triggers and would otherwise empty the hash chain
  outright.
- Independently of the triggers, the `audit_writer` database role (what the Audit Service
  connects as at runtime) is granted `INSERT` and `SELECT` only. It has no `UPDATE` or
  `DELETE` grant to fall back on even if a trigger were ever disabled.

A correction to a submitted inspection is a new, linked inspection row, never an edit to the
old one. If a workflow, a support request, or a "just this once" data-fix ever seems to call
for editing one of these three tables directly, it does not: the trigger will reject it, and
if you are a database superuser working around the trigger (`ALTER TABLE ... DISABLE
TRIGGER`, direct row surgery, restoring a hand-edited dump), you have defeated the one
property this system's compliance story depends on. That is the tamper-evidence Alberta OHS
Part 6 record-keeping and the audit design (ADR 0007, ADR 0008) both rely on. Do not do it,
and do not write a procedure, script, or support macro that does it, even for a single row,
even temporarily.

`db/migrations/` and `services/audit/` both carry a two-reviewer requirement in CODEOWNERS
for exactly this reason: a change that touches how these tables can be written gets more
scrutiny than ordinary code.

### 1.2 Never bypass equipment readiness (ADR 0006)

Equipment is computed READY, not set READY, at read time: it requires a passing Inspection
submitted on the current lab-local calendar day, submitted at or after the equipment's
`readiness_baseline_at` watermark, with the equipment not OUT_OF_SERVICE or RETIRED and no
open blocking Defect. There is no stored "READY" flag to flip and no scheduled job to
short-circuit.

Do not:

- Force an equipment record to READY status to unblock a demo, a support request, or a
  "just get it working" moment. There is no supported way to do this, and if one is ever
  added, it defeats the OHS s.257 requirement that a competent human actually performed
  today's inspection.
- Backdate or edit an Inspection's `submitted_at` to make an old inspection count as today's.
  This is blocked by the same immutability trigger as section 1.1.
- Skip the same-day re-inspection requirement after a return-to-service. Return-to-service
  intentionally resets `readiness_baseline_at` to the current time specifically so an
  earlier same-day passing inspection can no longer satisfy readiness; that is the fix for
  the "repaired mid-shift" case, not a bug to route around.

If equipment is stuck showing AWAITING_INSPECTION and someone asks you to make it READY
some other way, the correct action is to have a competent operator complete a real
inspection, not to intervene in the data.

---

## 2. Service health: what to check when something is unhealthy

Nine services run under Compose: `postgres`, `azurite`, `caddy`, `core-api`, `media`,
`audit`, `ai`, `pwa`, `dashboard` (plus the non-serving `db-backup` and `voice-retention`
scheduler containers). Start here:

```bash
docker compose ps
./scripts/docker-health-check.sh
```

The script polls for up to 3 minutes (services declare a 60-second `start_period`, so
"starting" right after a restart is expected, not a fault) and distinguishes a service still
warming up from one that hard-failed (`Exited` or not running, which will not recover by
waiting).

| Symptom                                                                                                    | Likely cause                                                                                                                                                                       | Where to look                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A service exits immediately after start, logs `boot aborted: ...`                                          | ADR 0015 boot validation rejected a blank or placeholder env var (core-api, audit)                                                                                                 | The log line names the exact variable. Fix `.env` and restart.                                                                                                                                                                                              |
| `ai` reports healthy, but `/transcribe` returns 503 and `/advisory` returns `UNAVAILABLE`                  | `/models` is empty or not mounted                                                                                                                                                  | `docs/runbooks/ai-model-weights.md`, "Failure modes". Neither failure blocks inspection submit; it is a degraded feature, not an outage.                                                                                                                    |
| `ai` container dies at start with `Illegal instruction`                                                    | The llama.cpp build assumes CPU instructions this host's CPU lacks                                                                                                                 | Same runbook; the Dockerfile's instruction-set assumption needs relaxing for this CPU.                                                                                                                                                                      |
| Gateway (`caddy`) reports healthy in `docker compose ps`, but the site is unreachable from outside the box | Another process already holds host port 443, or the host-side bind failed; a container healthcheck cannot see this from inside the container                                       | `docs/runbooks/gateway-and-device-setup.md`, "Known failure: the gateway is healthy but nothing reaches it". Run `./scripts/smoke-gateway.sh` from the box, not just `docker compose ps`; it is the check that runs outside the container and catches this. |
| `POST /api/v1/ai/transcribe` or `/api/v1/media/upload` returns 200 (or 404) without a token instead of 401 | A routing regression in `infra/caddy/Caddyfile` or an auth gap in the target service; this is the exact class of bug ADR 0020 exists to prevent                                    | `./scripts/smoke-gateway.sh` catches this on every deploy; treat a failure here as a security incident, not a flaky test.                                                                                                                                   |
| `db-backup` or `voice-retention` shows unhealthy                                                           | The scheduler loop is wedged; the healthcheck reads a heartbeat file touched every 30s, so a stale heartbeat means the loop stopped, not that a nightly job simply has not run yet | `docker compose logs db-backup` / `docker compose logs voice-retention`.                                                                                                                                                                                    |
| Login works for some users, fails for others with a role-related 403                                       | An App Role value on the Entra registration is not exactly lowercase, or the user is not assigned the role; `requireRole` compares case-sensitively                                | `docs/runbooks/gateway-and-device-setup.md`'s App Role table; confirm via `az ad app show ... --query "roles: appRoles[].value"`.                                                                                                                           |
| Login fails at the Microsoft sign-in redirect itself                                                       | The origin is not registered as a redirect URI on the Entra app                                                                                                                    | `docs/runbooks/gateway-and-device-setup.md`, "Register the origin with Entra".                                                                                                                                                                              |

---

## 3. Reading logs

All services log structured JSON via Pino (Node services) or the Python equivalent; there
is no plaintext log format to grep by hand for meaning beyond the raw text.

```bash
docker compose logs <service>            # recent output
docker compose logs -f <service>         # follow
docker compose logs --since 1h <service> # a window
```

For anything beyond a single box's local logs, the same telemetry is exported to Azure
Monitor / Application Insights (`APPLICATIONINSIGHTS_CONNECTION_STRING`), which is the
place to correlate a request across services by request ID, look at error rates over time,
or search logs after the container itself has rotated them away. ARCHITECTURE.md section 13
covers what is instrumented.

What you will not find in a log, by design (CLAUDE.md, "Logging"): passwords, tokens, JWT
contents, raw request bodies, voice transcript text, or photo URLs containing user
identifiers. If a log line contains any of those, that is a bug to report, not a feature to
rely on for debugging.

---

## 4. Restarting safely

State lives in Postgres and Blob Storage, not in any container's filesystem. Restarting a
service, including a hard restart, does not lose data on its own.

```bash
docker compose restart <service>                    # in place
docker compose up -d --force-recreate <service>      # picks up a changed image or .env value
```

A few things worth knowing before you restart:

- **`postgres` restarting affects everything.** `core-api`, `media`, and `audit` all declare
  `depends_on: postgres: condition: service_healthy`, so Compose will not start them until
  Postgres reports healthy again, but a mid-shift Postgres restart still means every service
  that touches the database is briefly unavailable.
- **`ai` is independent.** Nothing else waits on it to be healthy; restarting it only affects
  transcription and advisory suggestions for the duration, not inspection submission.
- **`caddy` depends on every app and service it fronts** (for startup ordering, not health),
  so restart it last if you are restarting multiple services, or operators lose the gateway
  briefly even though the backend it points at is fine.
- **`db-backup` and `voice-retention` are safe to restart any time.** They run no server;
  restarting only resets their scheduler loop, and the next scheduled run still happens on
  time. Their heartbeat-based healthcheck (section 2) will briefly show "starting" after a
  restart; that is expected.
- **A `core-api` or `audit` restart re-runs ADR 0015's boot validation.** If someone edited
  `.env` since the last boot and introduced a blank or placeholder value, the restart is
  where that mistake surfaces, immediately and by name in the log, not later.

To bring the whole stack down and back up (for a host reboot, for example):

```bash
docker compose down       # stops and removes containers; named volumes (data) are untouched
docker compose up -d
./scripts/docker-health-check.sh
```

`docker compose down` does not touch `postgres_data`, `db_backups`, `azurite_data`,
`caddy_data`, or `caddy_config`; those are named volumes, not container filesystem. Do not
add `-v` to that command unless you specifically intend to delete all of them, including the
live database.

---

## 5. Scheduled jobs and how to confirm they ran

| Job                                   | Default schedule                      | Confirm it ran                                                                                           |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Nightly database backup (`db-backup`) | 02:00 UTC (`BACKUP_TIME`)             | `docker compose exec db-backup cat /backups/backup.log`; `docker compose exec db-backup ls -la /backups` |
| Audit chain full verification         | 02:30 lab-local (`CHAIN_VERIFY_TIME`) | `docker compose logs audit \| grep -i "chain verif"`                                                     |
| Voice-clip retention purge            | 03:30 UTC (`RETENTION_TIME`)          | `docker compose logs voice-retention`                                                                    |

The 02:00 / 02:30 / 03:30 stagger is deliberate, not arbitrary: it keeps the backup, the
chain verification, and the retention purge from overlapping on the same box. Do not move
one without checking the others stay clear.

The backup and retention services report healthy based on a liveness heartbeat, not job
freshness (section 2); a nightly job is idle 23 hours out of 24, so "healthy" does not by
itself mean last night's run succeeded. Check the log.

---

## 6. Backup and restore

Full procedure, retention policy, and the production (Azure managed backup) path live in
[runbooks/backup-and-restore.md](runbooks/backup-and-restore.md); this section is the
day-two summary.

**What backs up automatically:** `core_db` and `audit_db`, dumped nightly by `db-backup`
into the `db_backups` volume, verified restore-readable before being kept
(`pg_restore --list` plus, by default, a full restore into a throwaway database). This
host's own off-host copy job (rsync or equivalent) is what gets those dumps off this box;
Compose does not do that part on its own.

**What does not back up automatically:**

- The AI Service model weights (`./models`, bind-mounted read-only). Not in the database,
  not in Git. A host rebuilt from the database backup alone comes up with every service
  healthy except transcription, until `./scripts/fetch-ai-models.sh` runs again. This was
  found during the DEV-45 restore drill (2026-08-04) specifically because the AI Service's
  healthcheck does not probe model load, so nothing flags it except an operator recording a
  voice note and getting nothing back.
- Azurite, if this deployment still runs it. Dev-only data; a real deployment should be
  pointing at real Blob Storage, which carries its own managed redundancy (see
  DEPLOYMENT.md section 4).
- Configuration. It lives in Git and `.env`; back up `.env` itself through whatever secret
  storage this deployment uses. It is deliberately not in the `db_backups` volume.

**Restoring:** a scratch-database restore (non-destructive, alongside the live databases)
and a full host rebuild are both documented in
`docs/runbooks/backup-and-restore.md` section 3, including the exact commands. The full
rebuild procedure ends with `docker compose up -d`, the two smoke scripts from section 2 of
this doc, and now also a real operator login (added after the DEV-45 drill found that
neither smoke script logs in, so a broken redirect URI or role claim was invisible to both).

**Why a restore does not violate section 1's immutability rule:** `pg_restore` loads rows
with `COPY`, which the immutability triggers permit; they block `UPDATE`, `DELETE`, and
`TRUNCATE`, not a bulk load into an empty (or scratch) table. A restore is not an exception
carved out of the rule; it never needed one.

**Drill cadence:** rehearsed twice per the project plan, once in Sprint 4 and once before
the capstone demo (ARCHITECTURE.md 12.5). The Sprint 4 drill (DEV-45, 2026-08-04) is logged
in `backup-and-restore.md` section 3.3, including the AI-weights gap above and a second
finding: nothing currently stops an operator from submitting a fresh inspection against
equipment that is already OUT_OF_SERVICE (tracked separately as DEV-143, not fixed by this
doc). The second drill's evidence lands in DEV-49. A drill that worked on the host it was
rehearsed on is not evidence it works on this one; rehearse it here too.

---

## 7. Escalation and further reading

- Immutability and the audit chain: ADR 0007, ADR 0008, ARCHITECTURE.md 8.4.
- Equipment readiness: ADR 0006.
- Auth and the fail-closed route guard: ADR 0012, ADR 0014, ADR 0021.
- The gateway and TLS: ADR 0020, `docs/runbooks/gateway-and-device-setup.md`.
- AI Service weights and failure modes: `docs/runbooks/ai-model-weights.md`.
- Vulnerability and change management process (for patching and any change to this running
  deployment): `docs/VULNERABILITY_MANAGEMENT.md`, `docs/CHANGE_MANAGEMENT.md`.
- Security posture and threat model: `docs/security/security-review.md`, `SECURITY.md`.

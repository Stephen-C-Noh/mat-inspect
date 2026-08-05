# Runbook: database backup and restore

This runbook covers the DEV-43 backups: the nightly PostgreSQL dump on dev staging, how to verify
and restore it, retention, and how to confirm the managed backups on production. It implements
ARCHITECTURE.md sections 12.5 and 12.7.

Two environments, two mechanisms:

| Environment | Database                      | Backup mechanism                                           |
| ----------- | ----------------------------- | ---------------------------------------------------------- |
| Dev staging | PostgreSQL 16 container       | Nightly `pg_dump` by the `db-backup` compose service       |
| Production  | Azure Database for PostgreSQL | Azure automated backups (managed); confirmed with a script |

Production is not provisioned during the capstone (ADR 0016). The production section below is the
procedure the future business owner runs once Azure prod exists. It is not run now.

---

## 1. Dev staging: nightly pg_dump

### What runs

The `db-backup` service in `docker-compose.yml` runs one backup a day. It uses the same
`postgres:16-alpine` image as the database, so `pg_dump` matches the server major version (a dump
is not restorable into a server older than the `pg_dump` that wrote it). The service runs no
database of its own.

Each night the service (`infra/backup/pg-backup.sh`):

1. Lists every application database (today `core_db` and `audit_db`, plus the default database).
2. Dumps each one in PostgreSQL custom format to the `db_backups` volume.
3. Verifies each dump is restore-readable (see section 2).
4. Deletes dumps older than the retention window (see section 4).

The dumps land on the `db_backups` volume, which is separate from the `postgres_data` volume. A
backup on the same volume as the data it protects is lost with it. The host owner's rsync job copies
`db_backups` off-host each night, and encrypts it with age or GPG before it leaves the box
(ARCHITECTURE.md 12.5). That off-host step is outside this service.

### Configuration

All optional. The defaults work with no `.env` changes.

| Variable                | Default | Meaning                                                                                 |
| ----------------------- | ------- | --------------------------------------------------------------------------------------- |
| `BACKUP_TIME`           | `02:00` | Time of day the dump runs. See the timezone note below.                                 |
| `BACKUP_RETENTION_DAYS` | `7`     | Dumps older than this many days are deleted. Matches ADR 0005.                          |
| `BACKUP_RUN_ON_START`   | `true`  | Run one dump when the service starts, so a deploy leaves a fresh, verified dump behind. |
| `VERIFY_RESTORE`        | `true`  | Deep-verify each dump by restoring it into a throwaway database.                        |

Timezone: `BACKUP_TIME` is read in the container's local time. The container has no timezone set,
so that is UTC. `02:00` means 02:00 UTC. To run at 02:00 in the host's local time, set `TZ` on the
`db-backup` service (for example `TZ: America/Edmonton`).

### Trigger a backup by hand

```
docker compose exec db-backup /opt/backup/pg-backup.sh
```

### See what has been backed up

```
# List dumps on the backup volume
docker compose exec db-backup ls -la /backups

# Read the run log
docker compose exec db-backup cat /backups/backup.log
```

Dump file names are `<database>_<UTC-timestamp>.dump`, for example
`core_db_20260717T020000Z.dump`. The `globals_*.sql` files hold the role list without passwords, for
reference only; a clean rebuild recreates roles from `infra/docker/postgres-init.sh`.

### Health

The service is healthy while its scheduler loop is alive. The healthcheck reads a heartbeat file the
loop touches every 30 seconds. It does not check dump freshness: a nightly job is idle most of the
day, so freshness would report unhealthy 23 hours out of 24.

```
docker compose ps db-backup
```

---

## 2. How a dump is verified

A dump that cannot restore is worse than no dump: it hides the failure. Every dump is checked two
ways before it counts as good, and a dump that fails either check is deleted, not kept.

1. Archive readable: `pg_restore --list` parses the dump header and table of contents. A truncated
   or corrupt file fails here without touching the database.
2. Restore reproducible (deep verify, on by default): the dump is restored into a throwaway
   database, and the number of tables is compared against the source. A mismatch fails the run.

The deep verify restores with `--no-owner --no-acl`, so it does not depend on the real roles. The
throwaway database is dropped afterward, on every exit path. This is safe against the immutability
triggers (`db/migrations/0004`, audit `0000`): they block UPDATE and DELETE, and a restore loads
rows with COPY, which they allow. No real inspection or audit row is touched.

---

## 3. Restore drill

Run this drill twice per the plan: once in Sprint 4 and once the week before the capstone demo
(ARCHITECTURE.md 12.5, DEV-45 and DEV-49). A restore that worked in July does not prove a restore
works in August.

The drill restores a dump into a clean database and confirms the data is intact.

### 3.1 Restore into a scratch database (non-destructive)

This restores alongside the live databases, into a new name, so it does not overwrite anything.

```
# Pick the newest core_db dump
DUMP=$(docker compose exec -T db-backup sh -c 'ls -t /backups/core_db_*.dump | head -1')

# Create a scratch database and restore into it
docker compose exec -T postgres createdb -U "$POSTGRES_USER" core_db_restore_test
docker compose exec -T db-backup pg_restore \
  --no-owner --no-acl --exit-on-error \
  --dbname "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/core_db_restore_test" \
  "$DUMP"

# Confirm the data is there, then drop the scratch database
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d core_db_restore_test \
  -c "SELECT count(*) FROM inspections;"
docker compose exec -T postgres dropdb -U "$POSTGRES_USER" core_db_restore_test
```

### 3.2 Full host rebuild (simulate host failure)

This is the disaster-recovery path (ARCHITECTURE.md 12.6). RTO is 1 to 2 hours; RPO with nightly
dumps only is up to 24 hours.

1. On a clean host: `git pull` the repository, place the `.env` file, and copy the latest dumps into
   place from the off-host backup.
2. Fetch the AI Service model weights: `./scripts/fetch-ai-models.sh`. These are not in the database
   and not in Git (DEV-95; ~1.5 GB, license-bound, bind-mounted read-only from `./models`). A host
   rebuilt from the database backup alone comes up with every service healthy except transcription,
   which fails closed with a 503 until this step runs. Found during the DEV-45 drill (2026-08-04):
   the AI Service reported healthy throughout because its healthcheck does not probe model load, so
   this gap only surfaces when an operator records a voice note, not in `docker-health-check.sh`.
3. Start only the database: `docker compose up -d postgres`. Wait for it to report healthy. On first
   start `infra/docker/postgres-init.sh` creates `core_db`, `audit_db`, and the roles.
4. Restore each dump into its database:
   ```
   docker compose exec -T postgres pg_restore --no-owner --clean --if-exists \
     -U "$POSTGRES_USER" -d core_db /path/to/core_db_<timestamp>.dump
   ```
   Restore `audit_db` the same way. `audit_db` rows are append-only; the immutability triggers allow
   the COPY load a restore uses.
5. Start the rest of the stack: `docker compose up -d`.
6. Run the smoke checks: `./scripts/docker-health-check.sh` and `./scripts/smoke-gateway.sh`, then have
   an operator log in, read the equipment list, and submit one test inspection. The first two scripts
   check reachability and the auth surface; neither logs in, so a login-level regression (for example
   a redirect URI or role-claim break) is invisible to them.
7. Record the time taken and any issue found. The DR runbook is a capstone deliverable.

### 3.3 Drill log

| Date       | Ticket | Environment                                                                                                      | RTO (restore + smoke)                                                | Issues found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-04 | DEV-45 | Dev staging (M5 mini-PC), isolated compose project alongside the live stack, restoring the Aug 4 02:00 UTC dumps | ~1.5 min DB restore; all 9 services healthy within ~2 min of `up -d` | (1) AI model weights are not covered by the pg_dump backup or Git and must be fetched separately (`scripts/fetch-ai-models.sh`); added as step 2 above. (2) No gate stops an operator from opening and submitting a fresh inspection against equipment that is already `OUT_OF_SERVICE`; tracked separately, see the ticket link once filed. (3) The live stack's `caddy` container reported unhealthy at 12 days uptime; the drill's freshly started `caddy` was healthy, so this looks like a long-uptime issue on the live container, not a restore defect. Worth a look independent of this ticket. |

The measured RTO above is optimistic relative to a true from-scratch rebuild: this drill ran on a
host with the Docker images already cached (no image pull) and against dev staging's small synthetic
dataset (10 equipment, 8 inspections, 12 audit events). A cold host or a larger dataset will both add
time; the 1 to 2 hour RTO in ARCHITECTURE.md 12.6 already accounts for that and is not contradicted by
this result.

---

## 4. Retention and rotation

The nightly run deletes dumps older than `BACKUP_RETENTION_DAYS` (default 7). With the default, a
full week of nightly dumps is always on the volume. `backup.log` is not rotated; it is a small
append-only record of runs.

The default 7 days matches the production Azure retention (ADR 0005), so dev staging and prod age
dumps out on the same clock. Change it by setting `BACKUP_RETENTION_DAYS` in `.env`.

---

## 5. Production: confirm the Azure managed backups

Production uses Azure Database for PostgreSQL Flexible Server (ADR 0005) and Azure Blob Storage
(ADR 0004). Both keep backups as a managed feature, so the task on prod is to confirm the settings,
not to run a dump.

No SAIT-hosted production runs during the capstone (ADR 0016). This section is the procedure the
future business owner runs once Azure prod is provisioned, and again after any change to the database
or storage account.

### Run the verification

`infra/backup/verify-azure-backups.sh` reads the configuration with read-only Azure CLI calls and
exits non-zero if any required setting is missing. It changes nothing in Azure.

```
az login

AZ_RESOURCE_GROUP=<resource-group> \
AZ_PG_SERVER=<flexible-server-name> \
AZ_STORAGE_ACCOUNT=<storage-account-name> \
./infra/backup/verify-azure-backups.sh
```

### What it confirms

Required (the script fails if any is missing):

- Azure Database for PostgreSQL: automated backup retention is at least 7 days (ADR 0005).
- Azure Database for PostgreSQL: geo-redundant backup is enabled (ADR 0005).
- Azure Blob Storage: the account uses a geo-redundant SKU, GRS or RA-GRS or a zone variant
  (ADR 0004).
- Azure Blob Storage: blob soft delete is enabled with a retention window (ADR 0004).

Recommended (the script warns if missing, does not fail):

- Azure Blob Storage: versioning and point-in-time restore, which ADR 0004 lists as available.

Server-side encryption at rest is on by default for every Azure Storage account and cannot be turned
off (ADR 0004), so the script states it rather than gating on it.

A clean run prints `RESULT: production backup configuration confirmed.` and exits 0. That output is
the evidence for the DEV-43 production acceptance criteria.

---

## 6. What is not backed up

- Azurite (dev staging object storage): dev data only, not backed up (ARCHITECTURE.md 12.5). On prod,
  Azure Blob Storage replaces Azurite and is geo-redundant (section 5).
- Configuration: all in Git, not in these dumps.

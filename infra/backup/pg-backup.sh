#!/bin/sh
# Nightly PostgreSQL backup for dev staging (DEV-43, ARCHITECTURE.md 12.5 and 12.7).
#
# Runs one backup cycle: dump every application database in custom format, verify each
# dump is restore-readable, then rotate out dumps past the retention window. The
# db-backup compose service invokes this once per day via backup-scheduler.sh; an
# operator can also run it by hand for a manual backup or the Sprint 4 / pre-demo
# restore drill (docs/runbooks/backup-and-restore.md).
#
# Runs inside postgres:16-alpine, so the shell is busybox ash, not bash. Keep this POSIX.
# The image ships pg_dump/pg_restore/psql/createdb/dropdb at the same major version as the
# server (16), which pg_dump requires: a dump taken by an older pg_dump cannot restore into
# a newer server.
#
# Dumps only. This is dev-data recovery, not the system of record (ARCHITECTURE.md 12.7).
# Off-host copy and encryption before transfer are the host owner's rsync step, out of
# this script's scope (ARCHITECTURE.md 12.5, line "encrypted with age or GPG before
# transfer off-host").

set -eu

# --- Configuration (all overridable via the environment; compose sets sane defaults) ------
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
# PGUSER / PGPASSWORD come from POSTGRES_USER / POSTGRES_PASSWORD in compose. libpq reads
# them from the environment, so no credential ever appears on a command line or in the logs.
PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER
# PGPASSWORD is exported by the caller (compose env). Referenced through libpq only.

BACKUP_DIR="${BACKUP_DIR:-/backups}"
# Keep this many days of dumps. Default 7 mirrors the prod Azure retention in ADR 0005 so
# dev staging and prod age dumps out on the same clock.
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
# Deep verify restores each dump into a throwaway database and compares the table count
# against the source. Set to "false" to fall back to the cheaper archive-header check only
# (pg_restore --list). Default on: the ticket requires the dump be "verified restore-readable",
# and a header that parses does not prove the data restores.
VERIFY_RESTORE="${VERIFY_RESTORE:-true}"
# Fail fast if the server is unreachable rather than hanging the nightly run.
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGCONNECT_TIMEOUT

# UTC timestamp, sortable, filename-safe. Every artifact from one run shares it.
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Scratch databases created for restore verification, dropped in cleanup even on failure.
SCRATCH_DBS=""

log() {
  # Structured-ish single line: timestamp, level, message. Goes to both the container log
  # (stdout) and a log file on the backup volume so a failed night is visible after the fact.
  _level="$1"
  shift
  _line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [$_level] $*"
  echo "$_line"
  # Best effort: never let a log-write failure abort the backup itself.
  echo "$_line" >>"$LOG_FILE" 2>/dev/null || true
}

cleanup() {
  # Drop any scratch verification databases this run created. Runs on every exit path, so a
  # crash mid-verify does not leave verifyrestore_* databases behind for the next run to dump.
  for _db in $SCRATCH_DBS; do
    dropdb --if-exists "$_db" 2>/dev/null || true
  done
}
trap cleanup EXIT

# psql helper against the maintenance database (createdb/dropdb/enumeration live here, not in
# any application database).
psql_admin() {
  psql --dbname postgres --no-psqlrc --quiet --tuples-only --no-align -c "$1"
}

# --- Preflight ----------------------------------------------------------------------------
if ! mkdir -p "$BACKUP_DIR" 2>/dev/null || [ ! -w "$BACKUP_DIR" ]; then
  log ERROR "backup directory $BACKUP_DIR is not writable"
  exit 1
fi

if ! pg_isready --timeout="$PGCONNECT_TIMEOUT" >/dev/null 2>&1; then
  log ERROR "postgres at $PGHOST:$PGPORT is not accepting connections"
  exit 1
fi

# Enumerate application databases. Skip template databases, the empty 'postgres' maintenance
# database, and any leftover scratch databases from a crashed prior verify. Enumerating (rather
# than hardcoding core_db / audit_db) means a database added later is backed up with no change
# here.
DATABASES="$(psql_admin "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' AND datname NOT LIKE 'verifyrestore\\_%' ORDER BY datname;")" || {
  log ERROR "could not list databases"
  exit 1
}

if [ -z "$DATABASES" ]; then
  log ERROR "no application databases found to back up"
  exit 1
fi

log INFO "backup run $TS starting; databases:$(echo "$DATABASES" | tr '\n' ' ')"

# --- Verify one dump ----------------------------------------------------------------------
verify_dump() {
  # $1 = database name, $2 = dump file. Returns non-zero if the dump is not restore-readable.
  _db="$1"
  _file="$2"

  # Cheap gate first: the custom-format archive header and table of contents must parse.
  # A truncated or corrupt dump fails here without touching the server.
  if ! pg_restore --list "$_file" >/dev/null 2>&1; then
    log ERROR "$_db: dump archive is unreadable (pg_restore --list failed)"
    return 1
  fi

  if [ "$VERIFY_RESTORE" != "true" ]; then
    log INFO "$_db: archive header verified (deep restore verify disabled)"
    return 0
  fi

  # Deep verify: restore into a throwaway database and confirm it reproduces the same number
  # of user tables as the source. --no-owner / --no-acl drop the dependency on the real roles
  # (audit_migrator, audit_writer) so the scratch restore stands alone. --exit-on-error makes
  # any restore error fail the run instead of a partial restore passing silently.
  #
  # This is safe against the immutability triggers (db/migrations/0004, audit 0000): they block
  # UPDATE and DELETE, and a restore loads rows with COPY (an INSERT), which they allow. The
  # scratch database is dropped in cleanup; no real inspection or audit row is ever touched.
  _scratch="verifyrestore_${_db}_${TS}"
  # Postgres identifiers cap at 63 bytes; keep the scratch name inside that.
  _scratch="$(echo "$_scratch" | cut -c1-63)"

  if ! createdb "$_scratch" 2>/dev/null; then
    log ERROR "$_db: could not create scratch database $_scratch for verification"
    return 1
  fi
  SCRATCH_DBS="$SCRATCH_DBS $_scratch"

  if ! pg_restore --no-owner --no-acl --exit-on-error --dbname "$_scratch" "$_file" >/dev/null 2>&1; then
    log ERROR "$_db: restore into scratch database failed"
    return 1
  fi

  _src_tables="$(psql --dbname "$_db" --no-psqlrc --quiet --tuples-only --no-align \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');")"
  _restored_tables="$(psql --dbname "$_scratch" --no-psqlrc --quiet --tuples-only --no-align \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');")"

  if [ "$_src_tables" != "$_restored_tables" ]; then
    log ERROR "$_db: restore verify mismatch (source $_src_tables tables, restored $_restored_tables)"
    return 1
  fi

  log INFO "$_db: restore verified ($_restored_tables tables reproduced from dump)"
  return 0
}

# --- Dump + verify each database ----------------------------------------------------------
FAILURES=0
for DB in $DATABASES; do
  DUMP_FILE="${BACKUP_DIR}/${DB}_${TS}.dump"

  # Custom format (-Fc): compressed, and the only format pg_restore can verify, filter, and
  # restore selectively. pg_dump runs in a single snapshot, so the dump is internally consistent
  # even if writes land during the run.
  if ! pg_dump --format=custom --dbname "$DB" --file "$DUMP_FILE" 2>>"$LOG_FILE"; then
    log ERROR "$DB: pg_dump failed"
    rm -f "$DUMP_FILE"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  DUMP_BYTES="$(wc -c <"$DUMP_FILE" 2>/dev/null | tr -d ' ')"
  log INFO "$DB: dumped ${DUMP_BYTES} bytes to $(basename "$DUMP_FILE")"

  if ! verify_dump "$DB" "$DUMP_FILE"; then
    # A dump that will not restore is worse than no dump: it hides the failure. Remove it so
    # rotation cannot later treat it as a good recovery point.
    rm -f "$DUMP_FILE"
    FAILURES=$((FAILURES + 1))
    continue
  fi
done

# Role and membership topology, without password hashes (--no-role-passwords). Reference only:
# a clean restore recreates roles from infra/docker/postgres-init.sh and .env, so this is not on
# the restore path. Best effort; a globals failure does not fail the run.
if pg_dumpall --globals-only --no-role-passwords --file "${BACKUP_DIR}/globals_${TS}.sql" 2>>"$LOG_FILE"; then
  log INFO "globals: role topology captured (no passwords)"
else
  log WARN "globals: pg_dumpall --globals-only failed (non-fatal)"
fi

# --- Rotation -----------------------------------------------------------------------------
# Delete dumps and globals older than the retention window. -mtime +N matches files modified
# more than N*24h ago, so with the default 7 the newest deleted file is at least 7 days old and
# a full week of nightly dumps is always retained. backup.log is never rotated here; it is a
# small append-only record of runs.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name '*.dump' -o -name 'globals_*.sql' \) \
  -mtime +"$BACKUP_RETENTION_DAYS" -print -delete 2>/dev/null | wc -l | tr -d ' ')"
log INFO "rotation: removed ${DELETED} dump(s) older than ${BACKUP_RETENTION_DAYS} day(s)"

# --- Result -------------------------------------------------------------------------------
if [ "$FAILURES" -ne 0 ]; then
  log ERROR "backup run $TS finished with $FAILURES failure(s)"
  exit 1
fi

log INFO "backup run $TS complete; all dumps verified restore-readable"
exit 0

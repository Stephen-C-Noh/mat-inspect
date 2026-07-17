#!/bin/sh
# Entrypoint for the db-backup compose service (DEV-43). Runs pg-backup.sh once a day at
# BACKUP_TIME. Kept deliberately simple: a poll loop, no cron daemon, no date arithmetic that
# differs between busybox and GNU. It wakes every 30 seconds, and when the wall clock first
# reaches BACKUP_TIME on a new calendar day it runs one backup.
#
# Trade-off: if the container is down at exactly BACKUP_TIME the run is missed for that day.
# Acceptable for dev-staging recovery (ARCHITECTURE.md 12.7), and BACKUP_RUN_ON_START gives a
# fresh dump on every deploy regardless.

set -eu

# HH:MM, in the container's local time (UTC unless TZ is set). Matched exactly against the clock.
BACKUP_TIME="${BACKUP_TIME:-02:00}"
# Run one backup immediately on start. Default true so a redeploy always leaves a fresh, verified
# dump behind and proves the wiring works without waiting until 02:00.
BACKUP_RUN_ON_START="${BACKUP_RUN_ON_START:-true}"
# Heartbeat file touched on every poll. The compose healthcheck reads its age to tell the
# scheduler is alive (a nightly job is idle most of the day, so freshness of the last dump is
# the wrong liveness signal).
HEARTBEAT_FILE="${HEARTBEAT_FILE:-/tmp/db-backup-heartbeat}"

SCRIPT_DIR="$(dirname "$0")"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$1] scheduler: $2"
}

run_backup() {
  # Never let a failed backup kill the loop; log it and keep scheduling. The backup script's
  # own non-zero exit and ERROR lines surface the failure in the container log.
  if "${SCRIPT_DIR}/pg-backup.sh"; then
    log INFO "backup succeeded"
  else
    log ERROR "backup failed (see pg-backup output above); will retry on the next schedule"
  fi
}

log INFO "started; scheduled daily at ${BACKUP_TIME} (container local time)"

# Touch the heartbeat before the startup backup so the healthcheck has a file to read during a
# cold start. The loop below keeps it fresh every 30s.
touch "$HEARTBEAT_FILE" 2>/dev/null || true

if [ "$BACKUP_RUN_ON_START" = "true" ]; then
  log INFO "running startup backup (BACKUP_RUN_ON_START=true)"
  run_backup
fi

LAST_RUN_DATE=""
while true; do
  touch "$HEARTBEAT_FILE" 2>/dev/null || true
  NOW_HM="$(date +%H:%M)"
  NOW_DATE="$(date +%Y-%m-%d)"
  if [ "$NOW_HM" = "$BACKUP_TIME" ] && [ "$NOW_DATE" != "$LAST_RUN_DATE" ]; then
    log INFO "scheduled time reached"
    run_backup
    LAST_RUN_DATE="$NOW_DATE"
  fi
  sleep 30
done

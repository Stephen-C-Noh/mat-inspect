#!/bin/sh
# Entrypoint for the voice-retention compose service (DEV-41). Runs the raw voice-audio purge job
# once a day at RETENTION_TIME. Same shape as the db-backup scheduler (DEV-43): a poll loop, no
# cron daemon, no date arithmetic that differs between busybox and GNU. It wakes every 30 seconds,
# and when the wall clock first reaches RETENTION_TIME on a new calendar day it runs one purge.
#
# The purge itself (services/media/dist/jobs/purge-voice-audio.js) is idempotent, so a missed or
# repeated run never corrupts state: it deletes only clips already past the 90-day window and skips
# clips already gone. RETENTION_RUN_ON_START gives one purge on every deploy regardless.

set -eu

# HH:MM, in the container's local time (UTC unless TZ is set). Matched exactly against the clock.
RETENTION_TIME="${RETENTION_TIME:-03:30}"
# Run one purge immediately on start. Default true so a redeploy always reconciles retention and
# proves the wiring works without waiting until RETENTION_TIME.
RETENTION_RUN_ON_START="${RETENTION_RUN_ON_START:-true}"
# Heartbeat file touched on every poll. The compose healthcheck reads its age to tell the scheduler
# is alive (a daily job is idle most of the day, so freshness of the last purge is the wrong
# liveness signal).
HEARTBEAT_FILE="${HEARTBEAT_FILE:-/tmp/voice-retention-heartbeat}"

# Absolute path to the compiled purge job inside the media image. The media Dockerfile builds
# services/media/src into services/media/dist, so the jobs/ output lands here.
PURGE_JOB="/repo/services/media/dist/jobs/purge-voice-audio.js"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$1] voice-retention scheduler: $2"
}

run_purge() {
  # Never let a failed purge kill the loop; log it and keep scheduling. The job's own non-zero exit
  # and its Pino output surface the failure in the container log.
  if node "$PURGE_JOB"; then
    log INFO "purge run succeeded"
  else
    log ERROR "purge run failed (see job output above); will retry on the next schedule"
  fi
}

log INFO "started; scheduled daily at ${RETENTION_TIME} (container local time)"

# Touch the heartbeat before the startup purge so the healthcheck has a file to read during a cold
# start. The loop below keeps it fresh every 30s.
touch "$HEARTBEAT_FILE" 2>/dev/null || true

if [ "$RETENTION_RUN_ON_START" = "true" ]; then
  log INFO "running startup purge (RETENTION_RUN_ON_START=true)"
  run_purge
fi

LAST_RUN_DATE=""
while true; do
  touch "$HEARTBEAT_FILE" 2>/dev/null || true
  NOW_HM="$(date +%H:%M)"
  NOW_DATE="$(date +%Y-%m-%d)"
  if [ "$NOW_HM" = "$RETENTION_TIME" ] && [ "$NOW_DATE" != "$LAST_RUN_DATE" ]; then
    log INFO "scheduled time reached"
    run_purge
    LAST_RUN_DATE="$NOW_DATE"
  fi
  sleep 30
done

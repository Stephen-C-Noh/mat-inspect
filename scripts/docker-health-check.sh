#!/bin/bash
set -euo pipefail

SERVICES="postgres azurite caddy core-api media audit ai pwa dashboard"

# App services declare start_period: 60s, so they sit in "health: starting" for the
# first minute of a cold boot. Poll until everything is healthy (or a service hard-fails)
# instead of taking a single snapshot right after `up`. Override via env if needed.
TIMEOUT="${HEALTH_CHECK_TIMEOUT:-180}"
INTERVAL="${HEALTH_CHECK_INTERVAL:-5}"

deadline=$(( $(date +%s) + TIMEOUT ))

all_healthy=false
hard_fail=false
report=""

while true; do
  all_healthy=true
  report=""

  for svc in $SERVICES; do
    status=$(docker compose ps --format "{{.Status}}" "$svc" 2>/dev/null || true)
    [ -z "$status" ] && status="not running"
    report+="$(printf '%-20s %s' "$svc" "$status")"$'\n'

    if [[ "$status" == *"healthy"* ]]; then
      continue
    elif [[ "$status" == *"Exited"* || "$status" == "not running" ]]; then
      # A crashed or absent container will not recover by waiting; fail fast.
      all_healthy=false
      hard_fail=true
    else
      # "health: starting" or "Up" without a healthcheck: keep waiting.
      all_healthy=false
    fi
  done

  if [ "$all_healthy" = true ] || [ "$hard_fail" = true ] || [ "$(date +%s)" -ge "$deadline" ]; then
    break
  fi
  sleep "$INTERVAL"
done

echo "Service health:"
echo "---"
printf '%s' "$report"
echo "---"
if [ "$all_healthy" = true ]; then
  echo "All services healthy."
else
  echo "One or more services are not healthy. Run: docker compose logs <service>"
  exit 1
fi

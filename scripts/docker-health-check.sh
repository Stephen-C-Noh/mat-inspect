#!/bin/bash
set -euo pipefail

# Optional: the commit every service is expected to report in /health (DEV-99). Passed by
# deploy-staging.yml as the commit CI built images from. When set, a service on any other
# commit (or one too old to report a revision at all) fails this script instead of reporting
# healthy: a stack missing a whole feature is otherwise indistinguishable from a correct one by
# every signal docker compose ps exposes.
EXPECTED_SHA="${1:-}"

SERVICES="postgres azurite caddy core-api media audit ai pwa dashboard"
# Services with a GIT_SHA-reporting /health (the four backend services; pwa/dashboard have no
# such requirement, DEV-99's scope is core-api/media/audit/ai).
declare -A REVISION_PORTS=([core-api]=3000 [media]=3000 [audit]=3000 [ai]=8000)

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
if [ "$all_healthy" != true ]; then
  echo "One or more services are not healthy. Run: docker compose logs <service>"
  exit 1
fi
echo "All services healthy."

if [ -n "$EXPECTED_SHA" ]; then
  echo "Verifying every service reports commit $EXPECTED_SHA..."
  revision_mismatch=false
  for svc in "${!REVISION_PORTS[@]}"; do
    port="${REVISION_PORTS[$svc]}"
    if [ "$svc" = "ai" ]; then
      # python:3.12-slim has no wget (see services/ai/Dockerfile's own HEALTHCHECK, which uses
      # python for the same reason). wget worked silently here in testing: docker compose exec
      # returned nonzero for "command not found", the `|| true` below swallowed it, and the
      # empty body just looked like a service with no revision to report (DEV-99 follow-up).
      body=$(docker compose exec -T "$svc" python -c \
        "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:${port}/health').read().decode())" \
        2>/dev/null || true)
    else
      body=$(docker compose exec -T "$svc" wget -qO- "http://127.0.0.1:${port}/health" 2>/dev/null || true)
    fi
    # grep -o exits 1 on no match (empty body, or a pre-DEV-99 image with no "revision" key), which
    # under pipefail would otherwise kill this script outright instead of reporting the mismatch.
    revision=$(printf '%s' "$body" | grep -o '"revision":"[^"]*"' | cut -d'"' -f4 || true)
    if [ "$revision" = "$EXPECTED_SHA" ]; then
      printf '%-20s %s\n' "$svc" "$revision"
    else
      printf '%-20s %s (expected %s)\n' "$svc" "${revision:-<no revision reported>}" "$EXPECTED_SHA"
      revision_mismatch=true
    fi
  done
  if [ "$revision_mismatch" = true ]; then
    echo "One or more services are running a different commit than the one just deployed."
    exit 1
  fi
  echo "All services on $EXPECTED_SHA."
fi

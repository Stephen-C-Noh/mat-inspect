#!/bin/bash
# Gateway smoke checks. Runs on the deploy box after the containers report healthy.
#
# These check the properties the gateway is responsible for (ADR 0020): the site answers, and the
# AI Service has no unauthenticated path from the browser. They do not check that transcription
# works; the 401 below is raised by core-api's own hooks, so it stays green against a stale AI
# Service, an unreachable one, or one with no weights loaded. That check is scripts/smoke-transcribe.sh,
# which needs an operator token and runs on demand.
set -euo pipefail

BASE_URL="${GATEWAY_BASE_URL:-https://mat-inspect.staging}"
# The certificate is from Caddy's own internal CA. Verify against its root when the box has it
# exported; fall back to skipping verification, since this is a reachability check, not a TLS test.
CA_ROOT="${CADDY_CA_ROOT:-}"
CURL=(curl --silent --show-error --max-time 15)
if [ -n "$CA_ROOT" ] && [ -f "$CA_ROOT" ]; then
  CURL+=(--cacert "$CA_ROOT")
else
  CURL+=(--insecure)
fi

# The gateway is on this box, and the box has no reason to carry a hosts entry for its own site
# name. Resolve the name locally rather than through DNS, which keeps the TLS SNI correct (a plain
# https://127.0.0.1 would not match the site block). Set GATEWAY_RESOLVE_IP empty to use real DNS.
RESOLVE_IP="${GATEWAY_RESOLVE_IP-127.0.0.1}"
if [ -n "$RESOLVE_IP" ]; then
  host="$(printf '%s' "$BASE_URL" | sed -E 's#^https?://([^/:]+).*#\1#')"
  CURL+=(--resolve "${host}:443:${RESOLVE_IP}")
fi

fail=0

check_status() {
  local name="$1" expected="$2" method="$3" path="$4"
  local actual
  # curl already prints 000 for a connection it never made; || true keeps set -e from killing the
  # run so every check reports, and stops the exit code appending a second 000 to the output.
  actual=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X "$method" "${BASE_URL}${path}" || true)

  if [ "$actual" = "$expected" ]; then
    printf '%-46s %s\n' "$name" "ok ($actual)"
  else
    printf '%-46s %s\n' "$name" "FAILED (expected $expected, got $actual)"
    fail=1
  fi
}

echo "Gateway smoke checks against ${BASE_URL}"
echo "---"

check_status "gateway answers on its own health path" 200 GET /gateway/health
check_status "the PWA is served at the gateway" 200 GET /

# The regression guard. A route to ai:8000 in the Caddyfile, or an unauthenticated proxy route in
# core-api, turns this into a 200 and an unauthenticated path to a model that accepts biometric PII.
check_status "AI transcribe rejects an unauthenticated call" 401 POST /api/v1/ai/transcribe

# The gateway routes the media prefix to the Media Service, which authenticates it. A 401 here means
# the request reached media (or core-api) and was rejected for the right reason; a 404 would mean the
# routing table sent it somewhere with no such route, which is the bug this ticket exists to kill.
check_status "media upload rejects an unauthenticated call" 401 POST /api/v1/media/upload

echo "---"
if [ "$fail" -eq 0 ]; then
  echo "Gateway smoke checks passed."
else
  echo "Gateway smoke checks failed."
  exit 1
fi

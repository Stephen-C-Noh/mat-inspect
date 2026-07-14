#!/bin/bash
# End-to-end check of the voice-note path: an authenticated operator sends a real clip through the
# gateway and gets a transcript back.
#
# On demand, not on every deploy (ADR 0020). The token is an Entra USER token. Minting one in CI
# needs either a user's credentials or a new app permission, and the operator role is a user role
# that a service principal cannot hold, so a human pastes a token instead.
#
# Get a token: sign in to the PWA as an operator, open the browser console, and read the access
# token MSAL cached for the API scope (see docs/runbooks/entra-test-users-and-tokens.md).
#
# Usage: scripts/smoke-transcribe.sh <access-token> [clip.wav]
#
# This is the check that fails when the deployed AI Service is stale, when its weights are missing
# from the bind mount, or when the model fails to load. The unauthenticated 401 check in
# smoke-gateway.sh cannot see any of that: it never reaches the AI Service.
set -euo pipefail

TOKEN="${1:-}"
CLIP="${2:-}"

if [ -z "$TOKEN" ]; then
  echo "usage: $0 <access-token> [clip.wav]" >&2
  exit 2
fi

BASE_URL="${GATEWAY_BASE_URL:-https://mat-inspect.staging}"
CA_ROOT="${CADDY_CA_ROOT:-}"
CURL=(curl --silent --show-error --max-time 60)
if [ -n "$CA_ROOT" ] && [ -f "$CA_ROOT" ]; then
  CURL+=(--cacert "$CA_ROOT")
else
  CURL+=(--insecure)
fi

# Resolve the site name to the box when running on it, so no hosts entry is needed and the TLS SNI
# still matches. Set GATEWAY_RESOLVE_IP empty when running from a device that resolves it properly.
RESOLVE_IP="${GATEWAY_RESOLVE_IP-127.0.0.1}"
if [ -n "$RESOLVE_IP" ]; then
  host="$(printf '%s' "$BASE_URL" | sed -E 's#^https?://([^/:]+).*#\1#')"
  CURL+=(--resolve "${host}:443:${RESOLVE_IP}")
fi

cleanup() { [ -n "${TMP_CLIP:-}" ] && rm -f "$TMP_CLIP"; }
trap cleanup EXIT

if [ -z "$CLIP" ]; then
  # No clip given: synthesise one second of a spoken-range tone. It transcribes to little or nothing,
  # which is fine. What this proves is that the model loaded and the pipeline ran, which is exactly
  # what a stale image or an empty weights mount breaks. Pass a real clip to check the words.
  command -v ffmpeg >/dev/null || {
    echo "no clip given and ffmpeg is not installed; pass a .wav path" >&2
    exit 2
  }
  TMP_CLIP="$(mktemp --suffix=.wav)"
  ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=220:duration=1" -ar 16000 -ac 1 "$TMP_CLIP"
  CLIP="$TMP_CLIP"
fi

echo "Posting ${CLIP} to ${BASE_URL}/api/v1/ai/transcribe"

response="$("${CURL[@]}" -w '\n%{http_code}' \
  -X POST "${BASE_URL}/api/v1/ai/transcribe" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${CLIP};type=audio/wav")"

status="$(printf '%s' "$response" | tail -n1)"
body="$(printf '%s' "$response" | sed '$d')"

echo "status: ${status}"
echo "body:   ${body}"

if [ "$status" != "200" ]; then
  echo "FAILED: expected 200 with a transcript." >&2
  case "$status" in
    401) echo "The token was rejected. It may be expired, or it may be an ID token rather than an access token for the API scope." >&2 ;;
    503) echo "The AI Service has no model loaded. Check the weights bind mount (AI_MODELS_DIR) on the box." >&2 ;;
    404) echo "The route does not exist on the service behind the gateway. The deployed image may predate the transcribe route." >&2 ;;
  esac
  exit 1
fi

# The AI Service answers with a transcript field. An empty one is acceptable for the synthetic tone;
# a missing one means the response is not what the PWA expects.
if ! printf '%s' "$body" | grep -q '"text"'; then
  echo "FAILED: 200, but the response carries no transcript field." >&2
  exit 1
fi

echo "Transcribe smoke check passed."

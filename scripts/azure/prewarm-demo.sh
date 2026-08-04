#!/usr/bin/env bash
# Pings each Azure Container Apps demo endpoint to force a cold-start scale-up
# before a live demo. Safe to run whether minReplicas is 0 or 1; a warm app
# just responds fast and the ping is a no-op.
#
# Must be run directly in an interactive terminal (not backgrounded, not
# piped) because the ai warm-up step below needs a real TTY for
# `az containerapp exec`.
#
# Usage: scripts/azure/prewarm-demo.sh
set -euo pipefail

RG="MAT-Inspect"
DOMAIN="purplerock-bdb84067.canadacentral.azurecontainerapps.io"

# External apps: reachable directly from the internet.
declare -A EXTERNAL_APPS=(
  [pwa]="/login"
  [dashboard]="/login"
  [core-api]="/health"
  [media]="/health"
  [audit]="/health"
)

echo "== Pre-warming externally reachable apps =="
for app in "${!EXTERNAL_APPS[@]}"; do
  path="${EXTERNAL_APPS[$app]}"
  url="https://${app}.${DOMAIN}${path}"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" || echo "FAIL")
  printf '%-10s %-60s -> %s\n' "$app" "$url" "$code"
done

echo
echo "== Pre-warming ai (internal ingress, longest cold start: whisper + llama.cpp model load) =="
echo "   routed through core-api via 'az containerapp exec' since ai has no public ingress."
if ! az containerapp exec -n core-api -g "$RG" --command \
  "curl -s -o /dev/null -w '%{http_code}\n' http://ai.internal.${DOMAIN}/health"; then
  echo "!! ai warm-up FAILED or was skipped (no TTY?). Run this step by hand before the demo:"
  echo "   az containerapp exec -n core-api -g $RG --command \\"
  echo "     \"curl -s -o /dev/null -w '%{http_code}\\n' http://ai.internal.${DOMAIN}/health\""
fi

echo
echo "Done. Re-run this script ~5 minutes before the demo starts -- scale-to-zero"
echo "apps idle back down after a period of inactivity."

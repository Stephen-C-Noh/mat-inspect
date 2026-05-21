#!/bin/bash
set -euo pipefail

SERVICES="postgres minio caddy core-api media audit ai pwa dashboard"

echo "Service health:"
echo "---"

all_healthy=true

for svc in $SERVICES; do
  status=$(docker compose ps --format "{{.Status}}" "$svc" 2>/dev/null || echo "not found")
  printf "%-20s %s\n" "$svc" "$status"
  if [[ "$status" != *"healthy"* && "$status" != *"running"* ]]; then
    all_healthy=false
  fi
done

echo "---"
if [ "$all_healthy" = true ]; then
  echo "All services healthy."
else
  echo "One or more services are not healthy. Run: docker compose logs <service>"
  exit 1
fi

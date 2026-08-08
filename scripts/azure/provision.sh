#!/usr/bin/env bash
set -euo pipefail

# Provision the MAT-Inspect team Azure demo (ADR 0024): Azure Container Apps + Azure Front Door, with
# a managed data tier (Blob, PostgreSQL Flexible Server, Azure Monitor). No VM, no Caddy.
#
# This is the executable companion to docs/runbooks/azure-deployment-and-entra-setup.md. Read that
# runbook first. Run this after `az login` on the target subscription. Review before running: it
# creates paid resources. Synthetic data only (ADR 0024); tear down with teardown.sh at handover.
#
# REUSES the existing resource group (default: MAT-Inspect) and does not recreate it. The existing
# Application Insights is reused via APPLICATIONINSIGHTS_CONNECTION_STRING (that reference is by
# connection string, so it works regardless of which RG the workspace lives in). Because the RG holds
# pre-existing resources, teardown.sh deletes only the demo resources by name, never the whole RG.
#
# Secrets are read from the environment, never hardcoded (CLAUDE.md). Set them first, for example by
# sourcing your .env.azure (see .env.azure.example), then run this script. It never echoes a secret.
#
# Extensions needed:
#   az extension add --name containerapp
#   az extension add --name rdbms-connect   # for `az postgres flexible-server execute`
#   az extension add --name front-door       # provides `az afd`

# --- Non-secret configuration (override via environment before running) --------------------------
RG="${RG:-MAT-Inspect}"                     # existing RG; reused, not recreated
LOC="${LOC:-canadacentral}"
LAW="${LAW:-mat-inspect-logs}"              # reused if it already exists in $RG
ACA_ENV="${ACA_ENV:-mat-inspect-env}"
ACR="${ACR:-matinspect$RANDOM}"            # ACR names are global and alphanumeric; override for reruns.
SA="${SA:-matinspect$RANDOM}"              # Storage account names are global, 3-24 lowercase alnum.
AI_SHARE="${AI_SHARE:-ai-models}"
PG="${PG:-mat-inspect-pg-$RANDOM}"         # PostgreSQL server names are global.
PG_ADMIN_USER="${PG_ADMIN_USER:-matadmin}"
FD="${FD:-mat-inspect-fd}"
TAG="${TAG:-latest}"
IMG_PREFIX="mat-inspect"                    # image repo prefix inside the registry
BUILD_IMAGES="${BUILD_IMAGES:-true}"       # set false if images are already in the registry

# --- Required secrets (from environment) --------------------------------------------------------
require() { if [ -z "${!1:-}" ]; then echo "ERROR: required env var $1 is not set" >&2; exit 1; fi; }
for v in ENTRA_TENANT_ID ENTRA_CLIENT_ID APPLICATIONINSIGHTS_CONNECTION_STRING \
         PG_ADMIN_PASSWORD AUDIT_MIGRATOR_DB_PASSWORD AUDIT_WRITER_DB_PASSWORD \
         CORE_API_MIGRATOR_DB_PASSWORD CORE_API_WRITER_DB_PASSWORD \
         AUDIT_INGEST_TOKEN CORE_API_INTERNAL_TOKEN REPORT_SIGNING_PRIVATE_KEY; do
  require "$v"
done
# Optional notification secrets default to empty (ADR 0013: blank silences the channel).
TEAMS_WEBHOOK_URL="${TEAMS_WEBHOOK_URL:-}"
SMTP_HOST="${SMTP_HOST:-}"; SMTP_PORT="${SMTP_PORT:-}"; SMTP_USER="${SMTP_USER:-}"
SMTP_PASS="${SMTP_PASS:-}"; SUPERVISOR_ALERT_EMAILS="${SUPERVISOR_ALERT_EMAILS:-}"

echo ">> Resource group (reuse existing; never recreate)"
if az group show -n "$RG" >/dev/null 2>&1; then
  echo "   reusing existing resource group: $RG"
else
  echo "ERROR: resource group '$RG' does not exist. Create it first, or set RG to the right name." >&2
  exit 1
fi

echo ">> Log Analytics workspace (reuse if present)"
if ! az monitor log-analytics workspace show -g "$RG" -n "$LAW" >/dev/null 2>&1; then
  az monitor log-analytics workspace create -g "$RG" -n "$LAW" -l "$LOC" -o none
fi
LAW_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW" --query customerId -o tsv)
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n "$LAW" --query primarySharedKey -o tsv)

echo ">> Container Apps environment"
az containerapp env create -g "$RG" -n "$ACA_ENV" -l "$LOC" \
  --logs-workspace-id "$LAW_ID" --logs-workspace-key "$LAW_KEY" -o none

echo ">> Container registry"
az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled true -o none
ACR_SERVER=$(az acr show -n "$ACR" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)

echo ">> Storage account, blob containers, and Azure Files share for AI weights"
az storage account create -g "$RG" -n "$SA" -l "$LOC" --sku Standard_LRS --kind StorageV2 -o none
SA_KEY=$(az storage account keys list -g "$RG" -n "$SA" --query '[0].value' -o tsv)
SA_CONN=$(az storage account show-connection-string -g "$RG" -n "$SA" -o tsv)
for c in mat-inspect-media mat-inspect-reports mat-inspect-voice; do
  az storage container create --account-name "$SA" --account-key "$SA_KEY" -n "$c" -o none
done
az storage share-rm create -g "$RG" --storage-account "$SA" -n "$AI_SHARE" --quota 5 -o none

echo ">> PostgreSQL Flexible Server (TLS enforced by default)"
if az postgres flexible-server show -g "$RG" -n "$PG" >/dev/null 2>&1; then
  echo "   reusing existing server: $PG"
else
  az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
    --admin-user "$PG_ADMIN_USER" --admin-password "$PG_ADMIN_PASSWORD" \
    --tier Burstable --sku-name Standard_B1ms --version 16 --storage-size 32 --yes -o none
fi
# Allow other Azure services (the special 0.0.0.0 rule) so the Container Apps can reach the server.
# firewall-rule create takes the server via --server-name and the rule via --name (re-run safe).
az postgres flexible-server firewall-rule create -g "$RG" --server-name "$PG" \
  --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none
PG_FQDN="${PG}.postgres.database.azure.com"

echo ">> Databases and least-privilege audit + core_api roles (mirrors infra/docker/postgres-init.sh, DEV-146)"
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d postgres \
  --querytext "CREATE DATABASE core_db;" -o none || true
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d postgres \
  --querytext "CREATE DATABASE audit_db;" -o none || true
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d postgres \
  --querytext "CREATE ROLE audit_migrator LOGIN PASSWORD '${AUDIT_MIGRATOR_DB_PASSWORD}';" -o none || true
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d postgres \
  --querytext "CREATE ROLE audit_writer LOGIN PASSWORD '${AUDIT_WRITER_DB_PASSWORD}';" -o none || true
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d postgres \
  --querytext "CREATE ROLE core_api_migrator LOGIN PASSWORD '${CORE_API_MIGRATOR_DB_PASSWORD}';" -o none || true
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d postgres \
  --querytext "CREATE ROLE core_api_writer LOGIN PASSWORD '${CORE_API_WRITER_DB_PASSWORD}';" -o none || true
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d audit_db \
  --querytext "ALTER SCHEMA public OWNER TO audit_migrator; \
    GRANT CREATE ON DATABASE audit_db TO audit_migrator; \
    GRANT CONNECT ON DATABASE audit_db TO audit_writer; \
    ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO audit_writer; \
    ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO audit_writer;" \
  -o none
# core_api_writer gets UPDATE too (equipment status, defect lifecycle, outbox.processed_at), unlike
# audit_writer's INSERT+SELECT-only grant; core-api never deletes a row, so no DELETE grant either.
az postgres flexible-server execute -n "$PG" -u "$PG_ADMIN_USER" -p "$PG_ADMIN_PASSWORD" -d core_db \
  --querytext "ALTER SCHEMA public OWNER TO core_api_migrator; \
    GRANT CREATE ON DATABASE core_db TO core_api_migrator; \
    GRANT CONNECT ON DATABASE core_db TO core_api_writer; \
    ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO core_api_writer; \
    ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO core_api_writer;" \
  -o none

# Derived connection strings (never printed). All carry sslmode=require (Azure PG mandates TLS).
CORE_API_DB_URL="postgres://core_api_writer:${CORE_API_WRITER_DB_PASSWORD}@${PG_FQDN}:5432/core_db?sslmode=require"
CORE_MIGRATOR_DB_URL="postgres://core_api_migrator:${CORE_API_MIGRATOR_DB_PASSWORD}@${PG_FQDN}:5432/core_db?sslmode=require"
AUDIT_API_DB_URL="postgres://audit_writer:${AUDIT_WRITER_DB_PASSWORD}@${PG_FQDN}:5432/audit_db?sslmode=require"
AUDIT_MIGRATOR_DB_URL="postgres://audit_migrator:${AUDIT_MIGRATOR_DB_PASSWORD}@${PG_FQDN}:5432/audit_db?sslmode=require"

if [ "$BUILD_IMAGES" = "true" ]; then
  echo ">> Building images in ACR (server-side; --target runtime matches the compose build target)"
  az acr build -r "$ACR" -t "${IMG_PREFIX}/core-api:${TAG}" -f services/core-api/Dockerfile --target runtime . -o none
  az acr build -r "$ACR" -t "${IMG_PREFIX}/media:${TAG}"    -f services/media/Dockerfile    --target runtime . -o none
  az acr build -r "$ACR" -t "${IMG_PREFIX}/audit:${TAG}"    -f services/audit/Dockerfile    --target runtime . -o none
  az acr build -r "$ACR" -t "${IMG_PREFIX}/ai:${TAG}"       --target runtime ./services/ai -o none
  az acr build -r "$ACR" -t "${IMG_PREFIX}/pwa:${TAG}"      -f apps/pwa/Dockerfile --target runtime \
    --build-arg NEXT_PUBLIC_AZURE_TENANT_ID="$ENTRA_TENANT_ID" \
    --build-arg NEXT_PUBLIC_AZURE_CLIENT_ID="$ENTRA_CLIENT_ID" . -o none
  az acr build -r "$ACR" -t "${IMG_PREFIX}/dashboard:${TAG}" -f apps/dashboard/Dockerfile --target runtime \
    --build-arg NEXT_PUBLIC_AZURE_TENANT_ID="$ENTRA_TENANT_ID" \
    --build-arg NEXT_PUBLIC_AZURE_CLIENT_ID="$ENTRA_CLIENT_ID" . -o none
fi

img() { echo "${ACR_SERVER}/${IMG_PREFIX}/$1:${TAG}"; }
REG_ARGS=(--registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS")

echo ">> AI Service (internal ingress, always warm, weights via Azure Files)"
az containerapp env storage set -g "$RG" -n "$ACA_ENV" --storage-name aiweights \
  --azure-file-account-name "$SA" --azure-file-account-key "$SA_KEY" \
  --azure-file-share-name "$AI_SHARE" --access-mode ReadOnly -o none
az containerapp create -g "$RG" -n ai --environment "$ACA_ENV" --image "$(img ai)" "${REG_ARGS[@]}" \
  --ingress internal --target-port 8000 --min-replicas 1 --cpu 2 --memory 4Gi \
  --secrets "appinsights=$APPLICATIONINSIGHTS_CONNECTION_STRING" \
  --env-vars \
    "APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appinsights" \
    "AI_MAX_CONCURRENCY=2" \
    "ADVISORY_MODEL_PATH=/models/qwen2.5-1.5b-instruct-q4_k_m.gguf" \
    "AI_TRANSCRIPTION_MODEL=/models/faster-whisper-small.en" \
    "HF_HUB_OFFLINE=1" -o none
# Mount the weights share at /models. ACA volume mounts are set through the app's YAML; see the
# runbook. Upload the weights (scripts/fetch-ai-models.sh output) to the '$AI_SHARE' file share first.
AI_FQDN=$(az containerapp show -n ai -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)

echo ">> media"
az containerapp create -g "$RG" -n media --environment "$ACA_ENV" --image "$(img media)" "${REG_ARGS[@]}" \
  --ingress external --target-port 3000 --min-replicas 1 \
  --secrets "storage=$SA_CONN" "appinsights=$APPLICATIONINSIGHTS_CONNECTION_STRING" \
  --env-vars \
    "AZURE_STORAGE_CONNECTION_STRING=secretref:storage" \
    "APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appinsights" \
    "ENTRA_TENANT_ID=$ENTRA_TENANT_ID" "ENTRA_CLIENT_ID=$ENTRA_CLIENT_ID" -o none

echo ">> audit"
az containerapp create -g "$RG" -n audit --environment "$ACA_ENV" --image "$(img audit)" "${REG_ARGS[@]}" \
  --ingress external --target-port 3000 --min-replicas 1 \
  --secrets "auditdb=$AUDIT_API_DB_URL" "ingest=$AUDIT_INGEST_TOKEN" \
    "appinsights=$APPLICATIONINSIGHTS_CONNECTION_STRING" "storage=$SA_CONN" \
    "internaltoken=$CORE_API_INTERNAL_TOKEN" "signingkey=$REPORT_SIGNING_PRIVATE_KEY" \
  --env-vars \
    "DATABASE_URL=secretref:auditdb" "AUDIT_INGEST_TOKEN=secretref:ingest" \
    "APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appinsights" \
    "ENTRA_TENANT_ID=$ENTRA_TENANT_ID" "ENTRA_CLIENT_ID=$ENTRA_CLIENT_ID" \
    "AZURE_STORAGE_CONNECTION_STRING=secretref:storage" \
    "REPORTS_BLOB_CONTAINER=mat-inspect-reports" "MEDIA_BLOB_CONTAINER=mat-inspect-media" \
    "REPORT_SIGNING_PRIVATE_KEY=secretref:signingkey" \
    "CORE_API_INTERNAL_TOKEN=secretref:internaltoken" \
    "CHAIN_VERIFY_TIME=02:30" "LAB_TIMEZONE=America/Edmonton" -o none

echo ">> core-api"
# ACA rejects a secret with an empty value. The notification channels are optional (ADR 0013): add
# their secrets and secretref env-vars only when set, so a blank TEAMS_WEBHOOK_URL / SMTP_PASS leaves
# the channel silent instead of failing app creation.
CORE_SECRETS=("coredb=$CORE_API_DB_URL" "ingest=$AUDIT_INGEST_TOKEN" \
  "appinsights=$APPLICATIONINSIGHTS_CONNECTION_STRING" "internaltoken=$CORE_API_INTERNAL_TOKEN")
CORE_ENV=("DATABASE_URL=secretref:coredb" \
  "ENTRA_TENANT_ID=$ENTRA_TENANT_ID" "ENTRA_CLIENT_ID=$ENTRA_CLIENT_ID" \
  "APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appinsights" \
  "AUDIT_INGEST_TOKEN=secretref:ingest" "CORE_API_INTERNAL_TOKEN=secretref:internaltoken" \
  "SMTP_HOST=$SMTP_HOST" "SMTP_PORT=$SMTP_PORT" "SMTP_USER=$SMTP_USER" \
  "SUPERVISOR_ALERT_EMAILS=$SUPERVISOR_ALERT_EMAILS")
if [ -n "$TEAMS_WEBHOOK_URL" ]; then
  CORE_SECRETS+=("teams=$TEAMS_WEBHOOK_URL"); CORE_ENV+=("TEAMS_WEBHOOK_URL=secretref:teams")
fi
if [ -n "$SMTP_PASS" ]; then
  CORE_SECRETS+=("smtppass=$SMTP_PASS"); CORE_ENV+=("SMTP_PASS=secretref:smtppass")
fi
az containerapp create -g "$RG" -n core-api --environment "$ACA_ENV" --image "$(img core-api)" "${REG_ARGS[@]}" \
  --ingress external --target-port 3000 --min-replicas 1 \
  --secrets "${CORE_SECRETS[@]}" \
  --env-vars "${CORE_ENV[@]}" -o none

echo ">> pwa and dashboard"
az containerapp create -g "$RG" -n pwa --environment "$ACA_ENV" --image "$(img pwa)" "${REG_ARGS[@]}" \
  --ingress external --target-port 3000 --min-replicas 1 \
  --env-vars "PORT=3000" "APP_NAME=pwa" -o none
az containerapp create -g "$RG" -n dashboard --environment "$ACA_ENV" --image "$(img dashboard)" "${REG_ARGS[@]}" \
  --ingress external --target-port 3000 --min-replicas 1 \
  --env-vars "PORT=3000" -o none

echo ">> Wiring internal service-to-service URLs (needs the FQDNs created above)"
AUDIT_FQDN=$(az containerapp show -n audit -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
CORE_FQDN=$(az containerapp show -n core-api -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update -g "$RG" -n core-api \
  --set-env-vars "AUDIT_SERVICE_URL=https://${AUDIT_FQDN}" "AI_SERVICE_URL=https://${AI_FQDN}" -o none
az containerapp update -g "$RG" -n audit \
  --set-env-vars "CORE_API_INTERNAL_URL=https://${CORE_FQDN}" -o none

echo ">> Front Door (edge, TLS, /api/v1 path routing)"
MEDIA_FQDN=$(az containerapp show -n media -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
PWA_FQDN=$(az containerapp show -n pwa -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
DASH_FQDN=$(az containerapp show -n dashboard -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
az afd profile create -g "$RG" --profile-name "$FD" --sku Standard_AzureFrontDoor -o none

make_og() { # name fqdn probepath
  az afd origin-group create -g "$RG" --profile-name "$FD" --origin-group-name "$1" \
    --probe-path "$3" --probe-protocol Https --probe-request-type GET \
    --probe-interval-in-seconds 60 --sample-size 4 --successful-samples-required 3 \
    --additional-latency-in-milliseconds 50 -o none
  az afd origin create -g "$RG" --profile-name "$FD" --origin-group-name "$1" --origin-name "$1-o" \
    --host-name "$2" --origin-host-header "$2" --https-port 443 --priority 1 --weight 1000 \
    --enabled-state Enabled --enforce-certificate-name-check true -o none
}
make_og og-core "$CORE_FQDN"  /health
make_og og-media "$MEDIA_FQDN" /health
make_og og-audit "$AUDIT_FQDN" /health
make_og og-pwa   "$PWA_FQDN"   /health
make_og og-dash  "$DASH_FQDN"  /api/health

# One endpoint per front end so the /* route sends to the right app without host-based scoping. Each
# endpoint shares the same /api/v1 path split. Custom domains are added per the runbook (DNS).
make_routes() { # endpoint appOriginGroup
  local ep="$1" appog="$2"
  az afd endpoint create -g "$RG" --profile-name "$FD" --endpoint-name "$ep" --enabled-state Enabled -o none
  az afd route create -g "$RG" --profile-name "$FD" --endpoint-name "$ep" --route-name r-media \
    --origin-group og-media --supported-protocols Https --patterns-to-match "/api/v1/media/*" \
    --forwarding-protocol HttpsOnly --https-redirect Enabled --link-to-default-domain Enabled -o none
  az afd route create -g "$RG" --profile-name "$FD" --endpoint-name "$ep" --route-name r-reports \
    --origin-group og-audit --supported-protocols Https --patterns-to-match "/api/v1/reports/*" \
    --forwarding-protocol HttpsOnly --https-redirect Enabled --link-to-default-domain Enabled -o none
  az afd route create -g "$RG" --profile-name "$FD" --endpoint-name "$ep" --route-name r-api \
    --origin-group og-core --supported-protocols Https --patterns-to-match "/api/v1/*" \
    --forwarding-protocol HttpsOnly --https-redirect Enabled --link-to-default-domain Enabled -o none
  az afd route create -g "$RG" --profile-name "$FD" --endpoint-name "$ep" --route-name r-app \
    --origin-group "$appog" --supported-protocols Https --patterns-to-match "/*" \
    --forwarding-protocol HttpsOnly --https-redirect Enabled --link-to-default-domain Enabled -o none
}
make_routes mat-inspect-pwa og-pwa
make_routes mat-inspect-dashboard og-dash

PWA_EP=$(az afd endpoint show -g "$RG" --profile-name "$FD" --endpoint-name mat-inspect-pwa --query hostName -o tsv)
DASH_EP=$(az afd endpoint show -g "$RG" --profile-name "$FD" --endpoint-name mat-inspect-dashboard --query hostName -o tsv)

cat <<EOF

Provisioning complete (resources added to existing RG: $RG).

Front Door default endpoints (usable immediately for testing):
  PWA:       https://${PWA_EP}
  Dashboard: https://${DASH_EP}

Next steps (runbook Part B):
  1. Upload AI model weights to the '${AI_SHARE}' Azure Files share and confirm the ai app mounts
     them at /models (az containerapp update --yaml, see the runbook).
  2. Run migrations: core-api against core_db as core_api_migrator (CORE_MIGRATOR_DB_URL), audit
     against audit_db as audit_migrator (AUDIT_MIGRATOR_DB_URL). Then seed synthetic data
     (db/seed.ts) into core_db.
  3. Add custom domains on the two Front Door endpoints (az afd custom-domain create), add the DNS
     records, and validate.
  4. Add the front-end origins (custom domains, or the default endpoints above) as SPA redirect URIs
     on the Entra app (runbook Part A.2).
  5. As hardening, restrict the external container apps to accept traffic only from this Front Door
     profile (X-Azure-FDID header check).
  6. Smoke test (runbook Part B.10). Tear down at handover: scripts/azure/teardown.sh.

Resource names created (pass the same values to teardown.sh):
  ACA_ENV=$ACA_ENV  ACR=$ACR  SA=$SA  PG=$PG  FD=$FD  LAW=$LAW
EOF

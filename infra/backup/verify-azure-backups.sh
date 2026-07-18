#!/usr/bin/env bash
# Verify production backup configuration on Azure (DEV-43).
#
# WHAT THIS IS. Production is Azure Database for PostgreSQL Flexible Server (ADR 0005) and Azure
# Blob Storage (ADR 0004). Both keep backups as a managed feature, so on prod the job is to
# CONFIRM the settings, not to run a dump. This script does exactly that with read-only Azure CLI
# calls and exits non-zero if any required setting is missing.
#
# WHEN IT RUNS. No SAIT-hosted production runs during the capstone (ADR 0016), so there is nothing
# to point this at yet. It ships ready to run and belongs to the post-handover provisioning step:
# the future business owner runs it once Azure prod exists, and again after any change to the
# database or storage account, to satisfy the DEV-43 prod acceptance criteria. Until then those
# two criteria are "verification automated and ready", not "confirmed on a live resource".
#
# SAFETY. Every Azure call is a `show`. This script reads configuration; it changes nothing in
# Azure. When AZ_SUBSCRIPTION is set it calls `az account set`, which changes only which
# subscription the local CLI targets, not any cloud resource.
#
# USAGE.
#   AZ_RESOURCE_GROUP=rg-mat-inspect \
#   AZ_PG_SERVER=mat-inspect-pg \
#   AZ_STORAGE_ACCOUNT=matinspectprod \
#   ./infra/backup/verify-azure-backups.sh
#
# Optional: AZ_SUBSCRIPTION (else the CLI default), EXPECT_PG_RETENTION_DAYS (default 7, ADR 0005).
#
# Field names in the --query expressions follow the Azure CLI object model. If a future CLI
# version renames one, verify against `az postgres flexible-server show --help` and
# `az storage account blob-service-properties show --help` rather than trusting this file.

set -euo pipefail

RESOURCE_GROUP="${AZ_RESOURCE_GROUP:-}"
PG_SERVER="${AZ_PG_SERVER:-}"
STORAGE_ACCOUNT="${AZ_STORAGE_ACCOUNT:-}"
SUBSCRIPTION="${AZ_SUBSCRIPTION:-}"
EXPECT_PG_RETENTION_DAYS="${EXPECT_PG_RETENTION_DAYS:-7}"

PASS=0
FAIL=0
WARN=0

pass() {
  echo "  PASS: $1"
  PASS=$((PASS + 1))
}
fail() {
  echo "  FAIL: $1"
  FAIL=$((FAIL + 1))
}
warn() {
  # Recommended, not required. A warning does not fail the run.
  echo "  WARN: $1"
  WARN=$((WARN + 1))
}

# --- Preconditions ------------------------------------------------------------------------
if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: the Azure CLI (az) is not installed. Install it and run 'az login' first." >&2
  exit 2
fi

if ! az account show >/dev/null 2>&1; then
  echo "ERROR: not logged in to Azure. Run 'az login' first." >&2
  exit 2
fi

missing=""
[ -z "$RESOURCE_GROUP" ] && missing="$missing AZ_RESOURCE_GROUP"
[ -z "$PG_SERVER" ] && missing="$missing AZ_PG_SERVER"
[ -z "$STORAGE_ACCOUNT" ] && missing="$missing AZ_STORAGE_ACCOUNT"
if [ -n "$missing" ]; then
  echo "ERROR: set these environment variables:$missing" >&2
  echo "See the USAGE block at the top of this script." >&2
  exit 2
fi

# Pin the CLI to one subscription if the caller named one, so the checks cannot read a different
# tenant's resources by accident. This is local CLI state only, not a cloud change.
if [ -n "$SUBSCRIPTION" ]; then
  az account set --subscription "$SUBSCRIPTION"
fi

echo "Verifying production backup configuration"
echo "  resource group:  $RESOURCE_GROUP"
echo "  postgres server: $PG_SERVER"
echo "  storage account: $STORAGE_ACCOUNT"
echo

# --- Azure Database for PostgreSQL Flexible Server (ADR 0005) ------------------------------
echo "Azure Database for PostgreSQL: automated backups"
if ! az postgres flexible-server show \
  --resource-group "$RESOURCE_GROUP" --name "$PG_SERVER" -o none 2>/dev/null; then
  fail "could not read server '$PG_SERVER' in resource group '$RESOURCE_GROUP' (does it exist? is the name right?)"
else
  # Flexible Server always keeps automated backups; the settings that matter are the retention
  # window and whether backup storage is geo-redundant. Extract each as a scalar with --query,
  # which is far more robust than parsing the JSON blob.
  RETENTION_DAYS="$(az postgres flexible-server show \
    --resource-group "$RESOURCE_GROUP" --name "$PG_SERVER" \
    --query "backup.backupRetentionDays" -o tsv 2>/dev/null || true)"
  GEO="$(az postgres flexible-server show \
    --resource-group "$RESOURCE_GROUP" --name "$PG_SERVER" \
    --query "backup.geoRedundantBackup" -o tsv 2>/dev/null || true)"

  if [ -n "$RETENTION_DAYS" ] && [ "$RETENTION_DAYS" -ge "$EXPECT_PG_RETENTION_DAYS" ] 2>/dev/null; then
    pass "automated backup retention is ${RETENTION_DAYS} day(s) (>= ${EXPECT_PG_RETENTION_DAYS} required)"
  else
    fail "automated backup retention is '${RETENTION_DAYS:-unknown}' day(s); ADR 0005 requires >= ${EXPECT_PG_RETENTION_DAYS}"
  fi

  case "$(printf '%s' "$GEO" | tr '[:upper:]' '[:lower:]')" in
    enabled) pass "geo-redundant backup is enabled" ;;
    disabled) fail "geo-redundant backup is disabled; ADR 0005 requires geo-redundancy" ;;
    *) fail "could not read geoRedundantBackup (got '${GEO:-empty}')" ;;
  esac
fi
echo

# --- Azure Blob Storage (ADR 0004) --------------------------------------------------------
echo "Azure Blob Storage: replication and retention"
if ! SKU="$(az storage account show \
  --resource-group "$RESOURCE_GROUP" --name "$STORAGE_ACCOUNT" \
  --query "sku.name" -o tsv 2>/dev/null)"; then
  fail "could not read storage account '$STORAGE_ACCOUNT'"
else
  # Geo-redundant SKUs: GRS and RA-GRS (and their zone variants GZRS / RA-GZRS). LRS and ZRS
  # stay in one region and do not satisfy ADR 0004's geo-redundancy requirement.
  case "$SKU" in
    Standard_GRS | Standard_RAGRS | Standard_GZRS | Standard_RAGZRS)
      pass "replication is geo-redundant ($SKU)" ;;
    *)
      fail "replication is '$SKU'; ADR 0004 requires a geo-redundant SKU (GRS/RA-GRS/GZRS/RA-GZRS)" ;;
  esac

  # Blob soft delete is the retention control: deleted or overwritten blobs are recoverable for
  # the retention window. Required for "backup/retention confirmed".
  SOFT_DELETE_ENABLED="$(az storage account blob-service-properties show \
    --account-name "$STORAGE_ACCOUNT" \
    --query "deleteRetentionPolicy.enabled" -o tsv 2>/dev/null || true)"
  SOFT_DELETE_DAYS="$(az storage account blob-service-properties show \
    --account-name "$STORAGE_ACCOUNT" \
    --query "deleteRetentionPolicy.days" -o tsv 2>/dev/null || true)"

  if [ "$(printf '%s' "$SOFT_DELETE_ENABLED" | tr '[:upper:]' '[:lower:]')" = "true" ] \
    && [ -n "$SOFT_DELETE_DAYS" ] && [ "$SOFT_DELETE_DAYS" -gt 0 ] 2>/dev/null; then
    pass "blob soft delete is enabled with ${SOFT_DELETE_DAYS}-day retention"
  else
    fail "blob soft delete is not enabled with a retention window; ADR 0004 requires blob retention"
  fi

  # Recommended defence in depth. Point-in-time restore needs versioning and change feed on;
  # ADR 0004 lists point-in-time restore as available. Warn (not fail) so the two hard gates
  # above decide pass/fail while still flagging a gap.
  VERSIONING="$(az storage account blob-service-properties show \
    --account-name "$STORAGE_ACCOUNT" \
    --query "isVersioningEnabled" -o tsv 2>/dev/null || true)"
  PITR="$(az storage account blob-service-properties show \
    --account-name "$STORAGE_ACCOUNT" \
    --query "restorePolicy.enabled" -o tsv 2>/dev/null || true)"

  if [ "$(printf '%s' "$VERSIONING" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    pass "blob versioning is enabled"
  else
    warn "blob versioning is off; enable it for point-in-time restore (ADR 0004)"
  fi
  if [ "$(printf '%s' "$PITR" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    pass "point-in-time restore policy is enabled"
  else
    warn "point-in-time restore is off; ADR 0004 lists it as available"
  fi
fi
echo

# Server-side encryption at rest is on by default for every Azure Storage account and cannot be
# turned off (ADR 0004), so it is stated, not gated.
echo "Note: server-side encryption at rest is on by default for all Azure Storage accounts (ADR 0004)."
echo

# --- Result -------------------------------------------------------------------------------
echo "Summary: ${PASS} passed, ${FAIL} failed, ${WARN} warning(s)."
if [ "$FAIL" -ne 0 ]; then
  echo "RESULT: production backup configuration is INCOMPLETE. Fix the FAIL items above."
  exit 1
fi
echo "RESULT: production backup configuration confirmed."
exit 0

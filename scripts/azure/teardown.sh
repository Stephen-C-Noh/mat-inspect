#!/usr/bin/env bash
set -euo pipefail

# Tear down the MAT-Inspect Azure demo (ADR 0024) at handover.
#
# IMPORTANT: this does NOT delete the resource group. The RG (default: MAT-Inspect) holds pre-existing
# resources (for example the shared Application Insights), so this script deletes only the resources
# provision.sh created, by name. Pass the SAME variable values you used for provisioning.
#
# The shared Log Analytics workspace and Application Insights are NOT deleted by default (they may
# predate the demo). Set DELETE_LAW=true only if provision.sh created a demo-specific workspace you
# want removed. Application Insights is never touched here.

RG="${RG:-MAT-Inspect}"
ACA_ENV="${ACA_ENV:-mat-inspect-env}"
ACR="${ACR:?set ACR to the registry name provision.sh created}"
SA="${SA:?set SA to the storage account name provision.sh created}"
PG="${PG:?set PG to the PostgreSQL server name provision.sh created}"
FD="${FD:-mat-inspect-fd}"
LAW="${LAW:-mat-inspect-logs}"
DELETE_LAW="${DELETE_LAW:-false}"

echo "About to delete these DEMO resources from resource group '$RG' (the RG itself is kept):"
echo "  Front Door profile:      $FD"
echo "  Container Apps env:      $ACA_ENV (and every app in it)"
echo "  Container registry:      $ACR"
echo "  Storage account:         $SA  (all synthetic media, reports, voice, and AI weights)"
echo "  PostgreSQL server:       $PG  (all synthetic data)"
[ "$DELETE_LAW" = "true" ] && echo "  Log Analytics workspace: $LAW"
read -r -p "Type 'delete' to proceed: " CONFIRM
[ "$CONFIRM" = "delete" ] || { echo "aborted"; exit 1; }

# Front Door first (it references the app FQDNs as origins). Deleting the profile removes its
# endpoints, origin groups, origins, and routes.
az afd profile delete -g "$RG" --profile-name "$FD" --yes -o none 2>/dev/null || echo "  (front door already gone)"

# Deleting the environment removes every container app in it.
az containerapp env delete -g "$RG" -n "$ACA_ENV" --yes -o none 2>/dev/null || echo "  (aca env already gone)"

az acr delete -g "$RG" -n "$ACR" --yes -o none 2>/dev/null || echo "  (acr already gone)"
az storage account delete -g "$RG" -n "$SA" --yes -o none 2>/dev/null || echo "  (storage already gone)"
az postgres flexible-server delete -g "$RG" -n "$PG" --yes -o none 2>/dev/null || echo "  (postgres already gone)"

if [ "$DELETE_LAW" = "true" ]; then
  az monitor log-analytics workspace delete -g "$RG" -n "$LAW" --yes --force true -o none 2>/dev/null \
    || echo "  (log analytics already gone)"
fi

echo "Teardown complete. The resource group '$RG' and any pre-existing resources (including"
echo "Application Insights) were left intact. Remove the Front Door custom-domain DNS records"
echo "at your DNS provider, and remove the demo redirect URIs from the Entra app registration."

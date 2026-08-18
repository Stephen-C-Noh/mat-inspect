# Runbook: Azure Deployment and Entra ID Setup

This runbook has two parts. Part A registers the Entra ID application. Part B provisions the Azure
infrastructure and deploys the stack on Azure Container Apps with Azure Front Door. It is written as
the procedure the capstone team ran on its own Azure tenant for the live demo (ADR 0024), so a future
SAIT owner must replicate it in a SAIT-controlled tenant by changing the tenant, the region, and the
connection strings (ADR 0016, ADR 0002). It contains no secrets.

**The identity tenant and the Azure subscription used here are team-owned and are not part of the
handover.** The Entra app registration runs on a team member's personal Entra tenant, and the demo
infrastructure runs on a personal Azure subscription that is torn down at the end of the capstone
(2026-08-21). Neither is handed to SAIT, and a SAIT deployment cannot reuse them. The school must
create a new app registration in a SAIT-controlled Entra tenant (Part A) and provision new resources
in a SAIT subscription (Part B). None of the team's tenant values (tenant ID, client ID) carry over:
everything below documents what to create, not credentials to inherit. See ADR 0016 and
`docs/SAIT_IT_BRIEF.md`.

Read first:

- **ADR 0016** (no SAIT-hosted production; the capstone runs on team-owned infrastructure).
- **ADR 0024** (the team-owned Azure demo: Azure Container Apps, Front Door, managed data tier).
- **ADR 0019 / ADR 0020** (the AI Service has no public route; the single front door does the path split).
- **DEV-79** (governance adoption brief).

Hard guardrails:

- **Synthetic data only.** On a team-owned or personal tenant the infrastructure is not
  SAIT-controlled, so no real operator voice clips, names, emails, or inspection records may be
  loaded. Seed from `db/seed.ts` and use canned audio (ADR 0024).
- **Teardown.** The demo environment is torn down at the end of the capstone (2026-08-21). Run Part B
  step 11 so no dormant deployment holds data or accrues spend on the personal tenant.
- **AI Service is never public.** The `ai` container app uses internal ingress. Do not give it
  external ingress and do not add a Front Door route to it (ADR 0019, ADR 0020).

Prerequisites: the Azure CLI (`az login` to the target subscription) with the `containerapp` and
`front-door` capabilities (`az extension add --name containerapp`), and Docker to build and push the
service images. Set shell variables once, for example `RG=mat-inspect-demo`, `LOC=canadacentral`.

---

## Part A: Entra ID app registration

One app registration serves both front ends (the PWA and the dashboard) and the APIs (ADR 0002,
ADR 0012). For the capstone the team reuses its existing registration on the team's personal tenant
and only adds the Front Door hostnames as redirect URIs. That registration is not transferred to
SAIT. For a SAIT deployment, create a new registration and repeat every step below in the SAIT
tenant.

### A.1 Create (or reuse) the registration

Azure portal, Microsoft Entra ID, App registrations, New registration. Name `MAT-Inspect`, single
tenant. Record the **Application (client) ID** (`ENTRA_CLIENT_ID`) and the **Directory (tenant) ID**
(`ENTRA_TENANT_ID`).

### A.2 Redirect URIs (SPA platform)

Authentication, Add a platform, Single-page application. Add one redirect URI per front-end origin.
These are the **Front Door custom domains** created in Part B step 8, for example:

- PWA origin, for example `https://mat-inspect.<domain>`
- Dashboard origin, for example `https://dashboard.mat-inspect.<domain>`

Both front ends use `loginRedirect`; the redirect URI is the app origin itself. Do not use
`loginPopup` (iOS WebKit fails popup login silently). Come back and add these once the Front Door
domains exist.

### A.3 Expose the API scope

Expose an API, set the Application ID URI to `api://{clientId}`, add the scope `access_as_user`
(admins and users can consent), and enable it. The front ends request
`api://{clientId}/access_as_user` and send the access token to the APIs. ID tokens are never used as
the API bearer (ADR 0012).

### A.4 App Roles

App roles, create five. The **Value** must be lowercase and match the `UserRole` union in
`packages/shared-types/src/index.ts` exactly; `requireRole` compares case-sensitively (ADR 0002).

| Display name | Value        | Allowed member types |
| ------------ | ------------ | -------------------- |
| Operator     | `operator`   | Users/Groups         |
| Supervisor   | `supervisor` | Users/Groups         |
| Manager      | `manager`    | Users/Groups         |
| Admin        | `admin`      | Users/Groups         |
| Auditor      | `auditor`    | Users/Groups         |

Roles are not hierarchical (ADR 0021).

### A.5 Assign roles to users

Enterprise applications, MAT-Inspect, Users and groups, Add user/group. Assign each test user (or, in
a SAIT tenant, each staff member or group) to one or more App Roles. See
`docs/runbooks/entra-test-users-and-tokens.md`.

### A.6 Access token version 2

Manifest, set `requestedAccessTokenVersion` to `2`. Without this the token shape does not match what
`verifyToken` expects and validation fails (verified in DEV-30).

### A.7 Values for the environment

`ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` from above. The front ends also need these at build time as
`NEXT_PUBLIC_AZURE_TENANT_ID` and `NEXT_PUBLIC_AZURE_CLIENT_ID` (baked into the PWA and dashboard
images in Part B step 3).

---

## Part B: Infrastructure setup (Azure Container Apps + Front Door)

Target: each service is a container app in one ACA environment (`core-api`, `media`, `audit`, `ai`,
`pwa`, `dashboard`), Azure Front Door is the edge (TLS, custom domains, `/api/v1` path routing), and
the data tier is managed (Azure Blob Storage, Azure Database for PostgreSQL Flexible Server, Azure
Monitor). No VM, no Caddy, no Docker Compose. All resources in one region for data residency (the demo
uses Canada Central; ADR 0024).

### B.1 Provision the base resources

- Resource group: `az group create -n $RG -l $LOC`.
- Log Analytics workspace (the Azure Monitor sink for the ACA environment).
- ACA environment: `az containerapp env create` with `--logs-workspace-id` set to that workspace.
- Container registry: an Azure Container Registry (`az acr create`) or reuse GitHub Container Registry
  (ghcr). The apps pull from it in step 5.
- Storage account with two roles: Blob containers (step 5) and an Azure Files share for the AI model
  weights (step 4). Create the file share with `az storage share-rm create`.
- PostgreSQL Flexible Server (`az postgres flexible-server create`), TLS enforced (default).

### B.2 Create databases and audit roles on the managed server

The managed server does not run `infra/docker/postgres-init.sh`. Create the two databases and the
least-privilege audit roles by hand, as the server admin, mirroring that script (ARCHITECTURE.md
section 8.4 rule 8, single-writer audit model). Allow your client IP
(`az postgres flexible-server firewall-rule create ...`) first, then as the admin against `postgres`:

```sql
CREATE DATABASE core_db;
CREATE DATABASE audit_db;
CREATE ROLE audit_migrator LOGIN PASSWORD '<AUDIT_MIGRATOR_DB_PASSWORD>';
CREATE ROLE audit_writer  LOGIN PASSWORD '<AUDIT_WRITER_DB_PASSWORD>';
```

Then against `audit_db`:

```sql
ALTER SCHEMA public OWNER TO audit_migrator;
GRANT CREATE ON DATABASE audit_db TO audit_migrator;
GRANT CONNECT ON DATABASE audit_db TO audit_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO audit_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO audit_writer;
```

`audit_writer` gets INSERT and SELECT only, never UPDATE or DELETE. Every managed PostgreSQL
connection string must carry `sslmode=require`.

### B.3 Build and push images

Build each service and app image and push to the registry. Build the PWA and dashboard with the Entra
build args so the client picks up the tenant and client id:

```
--build-arg NEXT_PUBLIC_AZURE_TENANT_ID=$ENTRA_TENANT_ID
--build-arg NEXT_PUBLIC_AZURE_CLIENT_ID=$ENTRA_CLIENT_ID
```

The `GATEWAY_URL` build arg does not carry browser traffic in this topology (the browser reaches Front
Door directly for `/api/v1`), so any internal placeholder is fine.

### B.4 AI model weights via Azure Files

ACA has no host bind mount, so the weights are delivered through the Azure Files share (this replaces
the host-mount design in `docs/runbooks/ai-model-weights.md` for the ACA deployment). Upload the
weights that `scripts/fetch-ai-models.sh` produces (`faster-whisper-small.en/` and the advisory GGUF)
to the share, then register the share with the environment
(`az containerapp env storage set --azure-file-account-name ... --azure-file-share-name ...
--access-mode ReadOnly`). The `ai` app mounts it at `/models` in step 5.

### B.5 Create the container apps

Create each app in the environment, pulling from the registry (`--registry-server`,
`--registry-username`/`--registry-password` or a managed identity). Set per-app secrets with
`--secrets` and reference them from `--env-vars` as `SECRETNAME=secretref:secretname`. Never put a
secret value directly in `--env-vars`.

Ingress and ports:

- `core-api`, `media`, `audit`: `--ingress external --target-port 3000`. External so Front Door can
  reach them; lock them to Front Door in step 7.
- `pwa`, `dashboard`: `--ingress external --target-port 3000`.
- `ai`: `--ingress internal --target-port 8000 --min-replicas 1`. Internal ingress means no public
  route; `min-replicas 1` keeps the model warm (no cold start). Mount the weights share at `/models`.

Environment variables per app mirror the service definitions, with managed endpoints and internal
FQDNs. Confirm each app's FQDN with `az containerapp show -n <app> -g $RG --query properties.configuration.ingress.fqdn`.
Internal service-to-service calls use those FQDNs over 443, replacing the Compose `http://<name>:3000`:

- `core-api`: `DATABASE_URL` (core*db, `sslmode=require`), `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
  `APPLICATIONINSIGHTS_CONNECTION_STRING`, `AUDIT_SERVICE_URL=https://<audit-fqdn>`,
  `AUDIT_INGEST_TOKEN`, `AI_SERVICE_URL=https://<ai-internal-fqdn>`, `CORE_API_INTERNAL_TOKEN`, and the
  optional notification vars (`TEAMS_WEBHOOK_URL`, `SMTP*\*`, `SUPERVISOR_ALERT_EMAILS`).
- `media`: `AZURE_STORAGE_CONNECTION_STRING`, `APPLICATIONINSIGHTS_CONNECTION_STRING`,
  `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`.
- `audit`: `DATABASE_URL` (audit_db as `audit_writer`, `sslmode=require`), `AUDIT_INGEST_TOKEN`,
  `APPLICATIONINSIGHTS_CONNECTION_STRING`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
  `AZURE_STORAGE_CONNECTION_STRING`, `REPORTS_BLOB_CONTAINER`, `MEDIA_BLOB_CONTAINER`,
  `REPORT_SIGNING_PRIVATE_KEY` (ADR 0022), `CORE_API_INTERNAL_URL=https://<core-api-fqdn>`,
  `CORE_API_INTERNAL_TOKEN`, `CHAIN_VERIFY_TIME`, `LAB_TIMEZONE`.
- `ai`: `ADVISORY_MODEL_PATH=/models/qwen2.5-1.5b-instruct-q4_k_m.gguf`,
  `AI_TRANSCRIPTION_MODEL=/models/faster-whisper-small.en`, `HF_HUB_OFFLINE=1`,
  `AI_MAX_CONCURRENCY`, `APPLICATIONINSIGHTS_CONNECTION_STRING`. Size `--cpu`/`--memory` to the model
  (Consumption caps at 4 vCPU / 8 GB; no GPU). Keep `AI_MAX_CONCURRENCY` equal to the vCPU count
  (ADR 0017).
- `pwa`: `PORT=3000`, `APP_NAME=pwa`. `dashboard`: `PORT=3000`.

Create the Blob containers used by media and audit: `mat-inspect-media`, `mat-inspect-reports`, and the
voice-clip container.

### B.6 Run migrations

Run the core-api migrations against `core_db` and the audit migrations against `audit_db` as
`audit_migrator` (via `AUDIT_MIGRATOR_DB_URL`), from a machine allowed through the PostgreSQL firewall,
or as an `az containerapp job`. Confirm `0004_inspection_immutability_triggers.sql` applies. Verify:
connecting as `audit_writer` and attempting `UPDATE` or `DELETE` on `audit_events` fails.

### B.7 Front Door (edge, TLS, path routing)

Create a Front Door Standard profile and an endpoint (`az afd profile create`, `az afd endpoint
create`). Create one origin group per backend app and add the app FQDN as its origin (`az afd
origin-group create`, `az afd origin create`): `pwa`, `dashboard`, `core-api`, `media`, `audit`. The
`ai` app is not an origin (no public route).

Create routes so both front-end domains share the same `/api/v1` path split (`az afd route create`,
lower path patterns win on the more specific match):

| Path pattern            | Origin group |
| ----------------------- | ------------ |
| `/api/v1/media/*`       | media        |
| `/api/v1/reports/*`     | audit        |
| `/api/v1/*`             | core-api     |
| `/*` (pwa domain)       | pwa          |
| `/*` (dashboard domain) | dashboard    |

Add the two custom domains and their managed certificates (`az afd custom-domain create`), and add the
matching DNS records at your DNS provider. As hardening, restrict each ACA app to accept traffic only
from this Front Door profile (validate the `X-Azure-FDID` header, or use Front Door Premium Private
Link), so the external apps are not reachable except through Front Door.

### B.8 Entra redirect URIs

Add the two Front Door custom-domain origins as SPA redirect URIs on the Entra app (Part A.2).

### B.9 Seed synthetic data

Run `db/seed.ts` against `core_db`. This is the only data source for the demo (ADR 0024).

### B.10 Smoke test

- Both custom domains serve over TLS through Front Door; `GET /gateway/health` is not present here
  (that was Caddy's); use a known app health path or the app root instead.
- MSAL login works on both domains.
- An operator submits a synthetic inspection; a voice note transcribes on the `ai` app (warm, no cold
  start).
- An auditor exports a signed PDF; verify its chain and signature.
- Data lands in Azure PostgreSQL and Blob; telemetry appears in Application Insights and the ACA
  environment's Log Analytics. On a fresh Application Insights workspace, allow roughly 1.5 hours for
  instrumentation-key propagation before telemetry shows up.

### B.11 Teardown

At the end of a demo window, run `scripts/azure/teardown.sh` with the same `RG`/`ACA_ENV`/`ACR`/`SA`/
`PG`/`FD` values used to provision (see `.env.azure`). It deletes the Front Door profile, the ACA
environment (and every app in it), the container registry, the storage account, and the PostgreSQL
server, by name.

It does **not** delete the resource group. The RG holds pre-existing resources (the shared Application
Insights), so `az group delete` is wrong here and would take those down too. The Log Analytics
workspace also survives by default (`DELETE_LAW=true` removes it if the demo created its own). Confirm
the PostgreSQL server, the storage account, and the Front Door profile are gone so no synthetic data or
spend remains, then remove the demo redirect URIs from the Entra app registration (Part A.2) and any
Front Door custom-domain DNS records.

### B.12 Re-provisioning after a teardown

Running `scripts/azure/provision.sh` again after a teardown recreates the stack, but four things need
manual follow-up; the script does not, and cannot, handle them on its own.

- **Front Door hostnames change.** The default `azurefd.net` endpoint hostname carries a random suffix
  assigned by Azure at creation, so a fresh Front Door profile gets a fresh hostname even with the same
  `FD` name. Update the Entra app's SPA redirect URIs (Part A.2) with the new hostnames before anyone
  can log in; the old ones are dead now that the origin Front Door profile is gone.
- **AI model weights are gone.** Teardown deletes the storage account, so the `ai-models` Azure Files
  share is gone with it. Re-upload the weights (Part B.4) before the `ai` app can serve advisory checks
  or transcription.
- **The database is empty.** Teardown deletes the PostgreSQL server, so the new one has no schema and
  no data. Re-run migrations (B.6) and re-seed (B.9) before smoke testing.
- **Build from the commit you actually want live.** `provision.sh` defaults `BUILD_IMAGES=true` and
  builds from the local working tree, so check out and pull the branch that should ship (usually `main`)
  before running it.

Resource names (`ACR`, `SA`, `PG`) default to a `$RANDOM` suffix, so a rerun without overrides creates
differently-named resources than the ones that were torn down. That is fine functionally; set the same
names via environment variables only if continuity of naming matters to you.

---

## What changes for a SAIT-hosted deployment

Only configuration. Repeat Part A in the SAIT tenant (new tenant ID, client ID, App Roles, role
assignments), and recreate the ACA environment, the container apps, Front Door, and the managed data
resources in the SAIT subscription with SAIT's connection strings. Remove the synthetic-data guardrail
(the tenant is now SAIT-controlled). No application code change is required (ADR 0016,
`SAIT_IT_BRIEF.md`).

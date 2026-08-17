# Deployment: Standing Up MAT-Inspect on a Fresh Host

This doc is for the future operational owner deploying the artifact: someone standing up
MAT-Inspect on a host that is not a developer laptop, most likely SAIT IT after adoption
(DEV-79, ADR 0016), or the team validating a clean-host deploy before handover. It assumes
no prior checkout, no prior `.env`, and no prior Entra registration on the target tenant.

If you are a developer bringing the stack up on your own machine to write code, use
[QUICKSTART.md](QUICKSTART.md) instead. This doc builds on it rather than repeating it: the
bring-up order, the `core_db` / `audit_db` split, the migrate-and-seed commands, and the
local port map are all defined there once. Read QUICKSTART.md first, specifically the
"Bring-up order" and "Databases" sections, before starting here.

Related reading: ADR 0016 (why there is no SAIT-hosted production during the capstone, and
what a deployable artifact means), ADR 0015 (the boot-validation rule this whole doc is
built around), ADR 0020 (Caddy is the single front door), `SAIT_IT_BRIEF.md` (what SAIT IT
would provision), `docs/runbooks/azure-deployment-and-entra-setup.md` (the alternative
Azure Container Apps topology, if the target is managed Azure rather than a host running
Docker Compose).

---

## 1. Which topology this doc covers

Two deployment shapes exist in this repo:

1. **Docker Compose on a host you control** (a VM, a mini-PC, an on-prem server). This is
   the artifact ADR 0016 defines as the capstone deliverable, and it is what this doc walks
   through.
2. **Azure Container Apps with Front Door**, a managed-services topology already fully
   scripted in `docs/runbooks/azure-deployment-and-entra-setup.md` Part B. Use that runbook
   instead of this one if the target is Azure-managed Postgres, Blob Storage, and
   autoscaling container apps rather than a single host.

Both need Part A of that same runbook (the Entra ID app registration) regardless of which
topology you pick; this doc points to it rather than duplicating it.

---

## 2. Prerequisites

**Host**, sized from ARCHITECTURE.md 12.3's production memory budget (~2.3 GB resident
with every service warm; the estimate predates the Advisory Check model, so treat it as a
floor, not a ceiling):

- Linux host, Docker Engine and the Docker Compose plugin installed.
- Minimum 4 vCPU, 8 GB RAM. The AI Service alone is capped at `cpus: 2` and `mem_limit: 4g`
  (ADR 0017); the rest of the stack needs headroom on top of that.
- Outbound HTTPS to: your Entra tenant's login and JWKS endpoints, your Azure Blob Storage
  account, your Application Insights endpoint, and (only during the one-time weights fetch
  in step 6) `huggingface.co`. The running `ai` container itself never calls out
  (`HF_HUB_OFFLINE=1`).
- Inbound 443 (and 80, for ACME's HTTP-01 challenge if you use a public hostname) reachable
  from wherever operators' devices are. No other inbound port: everything except Caddy sits
  on the internal Docker network only (ADR 0020).
- A DNS hostname pointed at the host, if this deployment is meant to be reachable by a real
  public name rather than the private `.staging` hostnames the repo ships with. See step 7.

**Local tooling**, only needed to run migrations from outside the containers (Docker does
not run them automatically):

- Node.js 22 LTS and `npm`, to run `npm install` once at the repo root and then
  `db:migrate` / `db:seed` from `services/core-api` and `services/audit`, exactly as
  QUICKSTART.md Path A describes.

---

## 3. Step 1: Register the Entra ID application

Follow `docs/runbooks/azure-deployment-and-entra-setup.md`, Part A, in the tenant this
deployment will actually authenticate against. That gives you `ENTRA_TENANT_ID` and
`ENTRA_CLIENT_ID`, the five App Roles (values lowercase, matching `UserRole` in
`packages/shared-types/src/index.ts`), and the exposed API scope. Do this before writing
`.env`; two of its required values come from this step.

Do not reuse the team's personal-tenant registration for a real deployment. That
registration is documented in `docs/runbooks/gateway-and-device-setup.md` as belonging to
the capstone's dev tenant specifically, and it is torn down or left dormant after handover.

---

## 4. Step 2: Provision the Azure resources config depends on

Two resources, both outside this repo's Compose file, both required by ADR 0015's boot
validator:

- **Application Insights** (or another Azure Monitor workspace), for
  `APPLICATIONINSIGHTS_CONNECTION_STRING`. Every Node and Python service in the stack sends
  telemetry here (ARCHITECTURE.md 13). Allow roughly 1.5 hours after creating a fresh
  workspace before telemetry appears.
- **Azure Blob Storage account**, for `AZURE_STORAGE_CONNECTION_STRING`. This is not the
  same thing as Azurite. Azurite is the emulator QUICKSTART.md uses for local dev and is
  explicitly a dev/dev-staging tool (ARCHITECTURE.md 12.3); it has no redundancy and is not
  meant to hold real inspection photos or voice clips. A real deployment needs a real
  storage account with the containers `media` and `audit` expect
  (`mat-inspect-media`, `mat-inspect-reports` by default; see `REPORTS_BLOB_CONTAINER` /
  `MEDIA_BLOB_CONTAINER` in `.env.example`).

`docker-compose.yml` as committed still defines an `azurite` service, and `media` depends
on it reporting healthy before it starts. If this deployment points
`AZURE_STORAGE_CONNECTION_STRING` at a real Blob Storage account, azurite runs unused
alongside it rather than being consulted; do not delete data from it, and do not treat its
health as meaningful once a real storage account is in play. Removing the azurite service
from the compose file for a real deployment is reasonable but is a change to a file this
doc does not otherwise ask you to edit; test that change before relying on it.

`SAIT_IT_BRIEF.md` lists the full resource table (identity, database, storage,
observability, compute) a SAIT-hosted target would need, if this deployment is that one.

---

## 5. Step 3: Get the code and pick what ships

```bash
git clone <the repository URL>
cd mat-inspect
git checkout <tag or commit the sponsor approved for this deployment>
```

Production deploys in this project are tag-triggered (ARCHITECTURE.md 14.1, step 9); pick a
tagged release rather than an arbitrary `main` commit, so what is running on this host has a
name you can point to later.

---

## 6. Step 4: Build a real `.env`

Copy `.env.example` to `.env` and fill in every value. This is the step ADR 0015 exists to
protect: **core-api and the audit service validate the whole environment once at boot, and
abort with a named variable in stderr if `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
`APPLICATIONINSIGHTS_CONNECTION_STRING`, or `AUDIT_INGEST_TOKEN` is blank or still holds a
placeholder value (`REPLACE_ME`, `xxxx`, `changeme`).** `NODE_ENV=test` is the only
exemption, and it does not apply to a deployed instance; do not set it here. If a service
exits immediately after `docker compose up`, read its log line first
(`[core-api] boot aborted: ...` or `[audit] boot aborted: ...`); it names the exact variable
to fix.

Values that come from the steps above:

| Variable                                | Source                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`    | Step 1                                                          |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Step 2 (must contain `InstrumentationKey=`)                     |
| `AZURE_STORAGE_CONNECTION_STRING`       | Step 2                                                          |
| `REGISTRY_OWNER`                        | Whichever GHCR owner published the images for the tag in step 3 |

Values you generate on this host, once, and keep only in `.env` (never commit them; see
CLAUDE.md's anti-pattern list on hardcoded credentials):

```bash
# Postgres application and audit-role passwords
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 24   # AUDIT_MIGRATOR_DB_PASSWORD
openssl rand -hex 24   # AUDIT_WRITER_DB_PASSWORD

# Shared bearer tokens between services
openssl rand -hex 32   # AUDIT_INGEST_TOKEN      (core-api -> audit)
openssl rand -hex 32   # CORE_API_INTERNAL_TOKEN (audit -> core-api, for report data)

# Report-signing key (ADR 0022): a PEM the Audit Service holds to sign exported PDF/CSV
# digests. config.ts accepts literal "\n" sequences in a single-line env value.
openssl genrsa -out report-signing-key.pem 2048
awk 'BEGIN{ORS="\\n"}1' report-signing-key.pem   # paste this output as REPORT_SIGNING_PRIVATE_KEY
rm report-signing-key.pem                        # do not leave the key material on disk unmanaged
```

`CORE_API_DB_URL` and `AUDIT_API_DB_URL` embed the Postgres passwords you just generated;
update them to match. `TEAMS_WEBHOOK_URL`, `SMTP_*`, and `SUPERVISOR_ALERT_EMAILS` are
optional (ADR 0013): leave them blank to disable that alert channel, or fill them in for the
FAIL_BLOCKING inspection alert to reach Teams and email. At least one of Teams or SMTP
should be set in a real deployment; the dashboard failure queue is the backstop, not the
primary channel.

---

## 7. Step 5: Provision the AI Service model weights

Run this once, before the first `docker compose up`, from the repo checkout:

```bash
./scripts/fetch-ai-models.sh
```

Full detail, including what "the service still boots but transcription 503s" looks like if
you skip this, is in `docs/runbooks/ai-model-weights.md`. The one thing worth restating
here: **this step is not covered by the database backup, and it is not in Git.** A host
rebuilt from a `pg_dump` restore alone comes up with every service healthy except
transcription. This was found during the DEV-45 restore drill (2026-08-04) precisely
because it is easy to forget; see `docs/runbooks/backup-and-restore.md` section 3.2.

---

## 8. Step 6: Bring up infra, migrate, and seed

Follow QUICKSTART.md's "Bring-up order" and Path A exactly:
`postgres`/`azurite` up, then `db:migrate` and `db:seed` from `services/core-api`, then
`db:migrate` from `services/audit`. This doc does not repeat those commands; QUICKSTART.md
is the one place they live.

One difference for a real deployment: `npm run db:seed` writes synthetic equipment and
checklist data (`db/seed.ts`), meant for dev and demo use, not for a live inspection
program. Whether this deployment should run it at all, and how real equipment records get
entered afterward, is an operational decision for whoever owns this deployment; nothing in
this repo documents a "load real equipment" procedure, because the capstone never operates
on real SAIT equipment data (ADR 0016). Decide that before going live, not after.

---

## 9. Step 7: TLS and the hostname

`infra/caddy/Caddyfile`, as committed, is hardcoded to two hostnames,
`mat-inspect.staging` and `dashboard.mat-inspect.staging`, and both site blocks use
`tls internal` (Caddy's own local CA). That is the right setup for the dev-staging model
`docs/runbooks/gateway-and-device-setup.md` documents: every device that opens the app
installs a CA root by hand.

A real deployment reachable at a public DNS name needs two edits to that file before first
boot, not just a config value:

1. Replace both hostnames with the real ones this deployment will answer to.
2. Remove `tls internal` from both site blocks. Without it, and with a real DNS name
   pointing at this host on port 80/443, Caddy requests a certificate from Let's Encrypt
   automatically on first request to that hostname (ARCHITECTURE.md 12.4). No further
   certificate management is needed after that.

Until both edits are made, this deployment is reachable only the way dev staging is: by
distributing a self-signed CA root to every device, per
`docs/runbooks/gateway-and-device-setup.md`. That may be the right choice for a short-lived
demo; it is very unlikely to be the right choice for an operational deployment operators and
supervisors reach from their own phones.

Whichever hostnames you land on, register them as SPA redirect URIs on the Entra app from
step 1 (`docs/runbooks/gateway-and-device-setup.md`, "Register the origin with Entra"), or
MSAL refuses to complete login from that origin.

---

## 10. Step 8: Bring up the full stack and verify

```bash
docker compose up -d
./scripts/docker-health-check.sh
```

`docker-health-check.sh` polls until every service reports healthy or one hard-fails
(services declare a 60-second `start_period`, so "starting" for the first minute is normal,
not a fault). Then run the gateway checks from the box:

```bash
./scripts/smoke-gateway.sh
```

This confirms the site answers, the PWA is served, and the AI transcription and media
upload routes reject unauthenticated calls with 401 rather than 404 (the regression ADR
0020 exists to prevent). It proves nothing about whether transcription actually works,
because it never reaches the AI Service; if this deployment relies on voice notes, follow up
with `scripts/smoke-transcribe.sh` using a real operator access token, per
`docs/runbooks/gateway-and-device-setup.md`'s "Checks" section.

Finally, sign in through the browser as at least one operator and one supervisor or
manager, and confirm the redirect URI and role claim actually work end to end. The two
scripts above check reachability and the auth surface; neither logs in, so a broken redirect
URI or a miscased App Role value is invisible to them (a gap the DEV-45 drill also
surfaced).

---

## 11. Step 9: Confirm backups are running

The `db-backup` service starts automatically with the rest of the stack and takes its first
dump immediately (`BACKUP_RUN_ON_START=true` by default), so a fresh deploy leaves a
verified dump behind without waiting for the nightly schedule. Confirm it:

```bash
docker compose ps db-backup
docker compose exec db-backup cat /backups/backup.log
```

The dumps land on the `db_backups` Docker volume, which this host's own off-host backup job
(rsync or equivalent) must copy off the box; Compose does not do that part. Full detail,
including the restore drill procedure and what it caught on 2026-08-04, is in
`docs/runbooks/backup-and-restore.md`. Run that drill on this host before relying on it, not
just on the host it was written from.

---

## 12. What changes for an Azure Container Apps deployment

If the target is Azure-managed Postgres, Blob Storage, and container apps rather than a
host you patch and restart by hand, none of steps 6 to 10 apply as written. Use
`docs/runbooks/azure-deployment-and-entra-setup.md` Part B instead, which walks the
equivalent steps (databases and roles, image build and push, container app creation, Front
Door routing, smoke test) for that topology. Part A (Entra registration) is shared between
both paths.

---

## 13. Fresh-host checklist

- [ ] Entra app registered in the target tenant; App Roles lowercase; redirect URIs added
      for the hostnames this deployment will use
- [ ] Application Insights workspace and Azure Blob Storage account provisioned
- [ ] Repo checked out at an agreed tag, not an arbitrary commit
- [ ] `.env` complete: no blank or placeholder value in any variable ADR 0015 requires
- [ ] AI model weights fetched (`scripts/fetch-ai-models.sh`) before first boot
- [ ] Database migrated and a deliberate decision made about seeding synthetic vs. real data
- [ ] Caddyfile hostnames and TLS mode match this deployment's real DNS situation
- [ ] `docker-health-check.sh` and `smoke-gateway.sh` both pass
- [ ] A real operator and a real supervisor/manager can sign in and reach their role's screens
- [ ] `db-backup` confirmed running; off-host copy of the `db_backups` volume confirmed
- [ ] A restore drill run on this host, not assumed from a drill run elsewhere

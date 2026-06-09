# Azure Deployment Cost Estimate (Version 2)

**Project:** MAT-Inspect (SAIT MAT Pre-Use Inspection System)
**Prepared:** May 2026
**Audience:** SAIT IT (post-handover reference); capstone instructor
**Scope:** Cost reference for production deployment on Azure if SAIT IT chooses that path. The team does not provision Azure resources during the capstone; all services run on a team-owned mini-PC via Docker Compose. See ARCHITECTURE.md s.12.2 for the deployment strategy.

---

## Architecture Summary

This estimate covers the Azure-managed-services deployment option. SAIT IT may also choose to run the full stack in Docker on a single VM (including self-hosted Postgres and MinIO), which reduces cost but increases operational burden. Both options use the same application code and Docker Compose configuration.

The recommended Azure posture moves the persistent layer to managed services and runs all stateless services on a single VM. This eliminates the database as a single point of failure.

- **Postgres and object storage** run as Azure managed services (automatic backups, PITR, geo-redundancy).
- **All application containers** run on one Azure VM via Docker Compose.
- **Entra ID** is the sole identity provider, using SAIT's existing institutional tenant at no extra cost.

**Note on MinIO vs. Azure Blob Storage:** The application's Media Service uses an S3-compatible client (AWS SDK v3) targeting MinIO. If SAIT IT chooses Azure Blob Storage instead, the storage client in the Media Service must be updated to use the Azure SDK (one service file). If SAIT IT keeps MinIO running in Docker on the VM, no code changes are needed and cost is lower.

---

## Managed Azure Services

| Service                                       | SKU / Tier                                         | Est. Cost (CAD/mo) | Notes                                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure VM                                      | Standard B2ms (2 vCPU, 8 GB RAM, 16 GB SSD)        | ~$95-110           | Hosts all application containers. 8 GB RAM is the minimum comfortable size for the Whisper AI service (~1.5 GB in-process). Upgrading to `medium.en` model would require B4ms (~double cost).                                                         |
| Azure Database for PostgreSQL Flexible Server | Burstable B1ms (1 vCore, 2 GB RAM) + 32 GB storage | ~$33-40            | Hosts both logical schemas (core_db and audit_db). Managed automated backups, point-in-time recovery (PITR) to 35 days, automated patching.                                                                                                           |
| Azure Blob Storage                            | LRS, hot tier                                      | ~$4-8              | Replaces self-hosted MinIO. Stores inspection photos, voice clips (90-day retention), and generated PDF reports. Estimated initial volume: 50-100 GB.                                                                                                 |
| Azure Key Vault                               | Standard tier                                      | ~$3-5              | Stores service secrets (DB passwords, audit chain signing key, SMTP credentials). Secrets are injected into containers at startup; nothing is hardcoded or in `.env` in production.                                                                   |
| Azure Container Registry (ACR)                | Basic tier                                         | ~$7-10             | Stores the 5 built container images (~5-10 GB total). During development the team uses GitHub Container Registry (GHCR), but production images should be pushed to an ACR under the SAIT tenant so SAIT IT retains full control over the image store. |
| Azure Entra ID                                | SAIT institutional tenant                          | $0                 | Covered by SAIT's existing Microsoft 365 license. SAIT IT registers the app in their tenant and assigns App Roles to users or groups via the Azure portal. See SAIT_IT_QUESTIONS.md for setup steps.                                                  |

**Estimated total (production): ~$142-175 CAD/month**

---

## What Runs on the VM (No Extra Azure Cost)

All of the following run inside the single B2ms as Docker containers:

| Container              | Role                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Caddy                  | TLS termination, reverse proxy, ACME cert renewal (Let's Encrypt)                                                |
| Core API               | Main business logic: equipment registry, checklists, inspection submissions, defect workflow (Node.js + Fastify) |
| Media Service          | Photo and voice clip upload handler, MinIO/Blob Storage client, presigned URL generation (Node.js + Fastify)     |
| Audit / Report Service | Hash-chained audit log writer, PDF report generation, CSV export (Node.js + Fastify)                             |
| AI Service             | Voice-to-text transcription using faster-whisper `small.en` model (~500 MB, CPU inference) (Python + FastAPI)    |
| Operator PWA           | Mobile-first Next.js app for Lab Techs (QR scan, checklist, voice dictation)                                     |
| Manager Dashboard      | Next.js app for supervisors and managers (compliance grid, defect inbox, reports)                                |
| Prometheus + Grafana   | Metrics collection and dashboards                                                                                |
| Loki + Promtail        | Structured log aggregation (30-day retention)                                                                    |
| Uptime Kuma            | Uptime monitoring and alerting                                                                                   |

**Memory budget on B2ms (Azure path, Postgres and Blob Storage off-VM):**

| Component                                                    | Est. RAM    |
| ------------------------------------------------------------ | ----------- |
| AI Service (Whisper `small.en` loaded)                       | ~1.5 GB     |
| Core API + Media + Audit (3 Node services)                   | ~450 MB     |
| PWA + Dashboard (2 Next.js containers)                       | ~300 MB     |
| Caddy + Prometheus + Grafana + Loki + Promtail + Uptime Kuma | ~1.0 GB     |
| **Total estimate**                                           | **~3.3 GB** |
| Headroom on 8 GB VM                                          | ~4.7 GB     |

---

## Staging Environment Options

A staging environment is required before the Sprint 5 pilot (per ARCHITECTURE.md s.12.1). Three options:

| Option                                           | Est. Cost (CAD/mo) | Trade-offs                                                                                                       |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Second B2ms VM (full mirror)                     | +$95-110           | Closest to production; safer for pilot testing.                                                                  |
| Smaller B2s VM (2 vCPU, 4 GB RAM)                | +$55-65            | Tight for AI Service; usable if Whisper model is loaded lazily or omitted in staging.                            |
| Separate compose stack on the same production VM | $0 extra           | Simplest for capstone scope. Shared resources mean staging load can affect production; acceptable at this scale. |

The team's owned mini-PC (GMKtec M5 Plus, 32 GB RAM) handles shared staging for Sprints 0-4. The forced migration to SAIT infrastructure is a Sprint 4 deliverable.

---

## What Is Not an Azure Cost

| Item                 | Reason                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Entra ID / SAIT SSO  | Covered by institutional M365 license                                   |
| TLS certificates     | Caddy handles ACME (Let's Encrypt) automatically on first start         |
| DNS                  | Managed by SAIT IT (e.g., `mat-inspect.sait.ca`)                        |
| GitHub Actions CI/CD | Free tier for educational repositories                                  |
| Outbound bandwidth   | First 100 GB/month free; this deployment will not exceed that at launch |

---

## Notes for SAIT IT

1. **VM provisioning:** Standard B2ms in Canada East or Canada Central region. The team deploys via `docker compose` over SSH; no AKS or App Service is needed.
2. **Entra ID app registration:** The team needs one app registration created in the SAIT tenant, with App Roles defined for Operator, Supervisor, Manager, Admin, and Auditor. Role assignments are managed via the Azure portal by SAIT IT or a delegated admin.
3. **Azure Key Vault:** One vault per environment (production, staging). The deploy user's managed identity needs `Key Vault Secrets User` role.
4. **PostgreSQL Flexible Server:** The team needs one instance with two databases (`core_db`, `audit_db`). Geo-redundant backup is recommended but optional; PITR at 7+ days is required for the 7-year record retention target.
5. **Blob Storage:** One storage account with two containers (`mat-inspect-media`, `mat-inspect-reports`). GRS replication is recommended. Lifecycle policy to tier voice clips to cool after 90 days (transcripts are kept in Postgres, not Blob).
6. **Azure Container Registry:** Provision one ACR instance (Basic tier) under the SAIT tenant. Grant the GitHub Actions service principal the `AcrPush` role so CI can push built images. Grant the VM's managed identity the `AcrPull` role so Docker Compose can pull them at deploy time. During development (Sprints 0-4) the team pushes to GitHub Container Registry (GHCR); the switch to ACR is a Sprint 6 pre-cutover task and requires a one-line change to the GitHub Actions workflow (`registry: <sait-acr-name>.azurecr.io`).
7. **Secrets handover:** At project completion (August 15, 2026), all secrets are rotated and the Key Vault is transferred to the SAIT IT team. The DR runbook and admin guide document the operational procedures.

---

## Summary

| Item                             | CAD/month     |
| -------------------------------- | ------------- |
| Azure VM (B2ms)                  | ~$95-110      |
| PostgreSQL Flexible Server       | ~$33-40       |
| Blob Storage                     | ~$4-8         |
| Key Vault                        | ~$3-5         |
| Azure Container Registry (Basic) | ~$7-10        |
| Entra ID                         | $0            |
| **Total**                        | **~$142-173** |

This is the cost for the production environment only. If SAIT IT provisions a separate staging VM, add ~$55-110/month depending on the VM size chosen.

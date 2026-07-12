# MAT-Inspect: IT Infrastructure Brief

**Prepared for:** SAIT IT Department
**Project:** MAT Pre-Use Inspection System (MAT-Inspect)
**Sponsor:** School of Manufacturing, Automation, and Transportation
**Handover Target:** August 15, 2026

**Status:** Post-handover provisioning request. This document describes what a SAIT-hosted
deployment would require. It does not describe the current state, and SAIT IT has not
committed to providing any of it.

SAIT ITS declined to host the system during the capstone (reply of 2026-06-24; see ADR
0016). The capstone runs entirely on team-owned hardware: the full stack (operator PWA,
manager dashboard, services, PostgreSQL, object storage) runs in Docker Compose on a
team mini-PC, with auth on a project-owned Entra tenant. Nothing below is a capstone
dependency.

The system is built so it can be adopted without redesign. If the School of MAT decides to
pursue adoption, and a business owner and governance approval are in place, the resources
listed here are what SAIT IT would provision at that point. Deployment to a SAIT tenant is
a configuration change (connection strings, tenant IDs, app registration), not a rewrite.

---

## What This System Does

MAT-Inspect replaces paper inspection sheets for ten pieces of high-risk equipment at SAIT Main Campus (4 overhead cranes, 2 trucks, 1 electric pallet jack, 3 forklifts). Lab Techs scan a QR code on the equipment and complete a digital checklist on a mobile device before each use. The system stores a tamper-evident record and blocks unsafe equipment from being marked operational.

Alberta OHS Code (Part 19, s.257) requires a visual inspection before equipment is operated. This system provides the digital audit trail required for compliance.

---

## What SAIT IT Would Need to Provision (Post-Handover)

The system uses Azure services already available in the SAIT tenant. No new vendors or services are introduced. None of the resources below is provisioned today; the list defines the target state if adoption proceeds.

| Resource        | Service                                              | Notes                                                                     |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Identity        | Azure Entra ID (existing SAIT tenant)                | Register one app, add 5 App Roles, assign to existing SAIT staff accounts |
| Database        | Azure Database for PostgreSQL Flexible Server        | Standard tier; estimated ~4 GB initial data                               |
| Object storage  | Azure Blob Storage                                   | Photos, voice clips, PDF exports; GRS replication; estimated ~50 GB/year  |
| Observability   | Azure Monitor (Log Analytics + Application Insights) | Metrics, structured logs, uptime checks, alerts                           |
| Compute         | 1 Azure VM (Standard_D2s_v3 or equivalent)           | 2 vCPU, 8 GB RAM, Ubuntu 24.04; runs all containers                       |
| TLS certificate | Let's Encrypt via Caddy (ACME)                       | Automatic; requires a public DNS hostname (e.g., mat-inspect.sait.ca)     |
| Secrets         | Azure Key Vault (recommended) or Docker Secrets      | For production credentials                                                |

**VM sizing note:** The largest component is the on-prem AI model (Whisper, ~1.5 GB RAM). Total estimated memory at steady state is 2.3 GB on an 8 GB VM.

---

## Authentication

The system uses Azure Entra ID exclusively. There is no separate user database or local identity store.

- All users authenticate with their existing SAIT accounts (Microsoft SSO).
- MFA, Smart Lockout, and conditional access policies are enforced at the Entra ID level. The application delegates these decisions to Entra ID.
- The application uses 5 App Roles: Operator, Supervisor, Manager, Admin, Auditor. These are defined in the app registration and assigned to SAIT staff accounts by IT.
- JWT access tokens have a 15-minute lifetime. Refresh tokens rotate on use.
- The handover from the team's dev tenant to SAIT's tenant requires one configuration change: update `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` in the environment file. No code changes.

---

## Security Controls

**Transport:** TLS 1.3 on all connections. Caddy handles certificate renewal automatically via Let's Encrypt. Internal service traffic stays on a private Docker network and is not exposed to the host.

**Access control:** Role-based, enforced at the API layer. Every endpoint declares its required role. Endpoints without a declared role fail closed (return 403). No endpoint bypasses the JWT check.

**Injection prevention:** All database queries use Drizzle ORM with parameterized queries. All API inputs validated with Zod schemas. No raw SQL string construction.

**Container hardening:**

- Non-root user in every container
- Read-only root filesystem; explicit tmpfs mounts for write-required paths
- `cap_drop: [ALL]`; capabilities added only where required
- `no-new-privileges: true`
- Resource limits (CPU and RAM) on each container
- Pinned base images; no `latest` tags

**Vulnerability scanning:** Trivy runs on every build. HIGH and CRITICAL CVEs with an available patch fail the build. Semgrep runs against OWASP Top 10 and security-audit rulesets.

**Secrets:** Production secrets are stored in Docker Secrets or Azure Key Vault. Never in environment variables committed to the repository. Gitleaks scans the full git history on every CI run.

**OWASP Top 10 posture:**

| Item                          | Control                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| A01 Broken Access Control     | Declarative RBAC, fail-closed, per-endpoint checks                   |
| A02 Cryptographic Failures    | TLS 1.3, encrypted backups, no plaintext secrets                     |
| A03 Injection                 | Drizzle ORM (parameterized), Zod input validation                    |
| A05 Security Misconfiguration | Hardened containers (Alpine/slim, non-root, read-only FS)            |
| A06 Vulnerable Components     | Trivy, Semgrep, npm audit, pip-audit on every build                  |
| A07 Authentication Failures   | Entra ID (MFA, Smart Lockout, conditional access managed by SAIT IT) |
| A08 Integrity Failures        | Hash-chained audit log, signed PDF exports                           |
| A09 Logging and Monitoring    | Azure Monitor Logs and Alerts; no PII in logs                        |

---

## Data Privacy (FOIP)

The system is hosted on SAIT-controlled infrastructure. All data stays within SAIT's Azure tenant.

**PII inventory:**

- Operator name and email (from Entra ID; stored as UUID reference only in logs)
- Voice clips (biometric PII under FOIP)
- Defect photos (may incidentally capture people)

**Controls:**

- Voice clips: encrypted at rest (Azure Blob Storage SSE), 90-day retention, access logged
- Inspection records: 7-year retention (Alberta OHS best practice), append-only after submission
- Geolocation: off by default; opt-in only
- The AI (voice transcription) model runs on-prem inside the SAIT VM. Audio never leaves SAIT infrastructure. No external AI API calls.

The team will request a FOIP review checklist from SAIT's privacy office in Sprint 0 and address any findings before the simulated pilot.

---

## Audit Log Integrity

The system maintains a hash-chained audit log. Each record contains the SHA-256 hash of the previous record, making retroactive modification detectable. The chain is verified on service startup and nightly.

Audit records are append-only. A database trigger blocks UPDATE and DELETE on the audit table. The application role used for normal operations has INSERT privilege only; it cannot modify or delete records.

This design meets the Alberta OHS Part 6 (Cranes) log book requirements for electronic records: each entry identifies the person, is timestamped, and cannot be altered after creation.

---

## Backup and Recovery

| Data                  | Backup method                                  | RPO          | Notes                                            |
| --------------------- | ---------------------------------------------- | ------------ | ------------------------------------------------ |
| Database (prod)       | Azure Database for PostgreSQL automated backup | ~5 min       | 7-day retention, geo-redundant; managed by Azure |
| Object storage (prod) | Azure Blob Storage GRS replication             | Near-zero    | Point-in-time restore available                  |
| Configuration         | Git (GitHub)                                   | Commit-level | All config tracked in version control            |

**RTO:** 1 to 2 hours for a full restore from the documented runbook. The team rehearses the restore procedure twice before handover (Sprints 4 and 6).

---

## What Changes at Handover

The application runs identically on SAIT infrastructure as it does on the team's development hardware. Only environment variables change. No code modifications are required.

| Variable                                | Dev value                   | SAIT IT sets                   |
| --------------------------------------- | --------------------------- | ------------------------------ |
| `AZURE_TENANT_ID`                       | Team's personal tenant      | SAIT tenant ID                 |
| `AZURE_CLIENT_ID`                       | Team's app registration     | SAIT's app registration        |
| `DATABASE_URL`                          | Team's Azure DB instance    | SAIT's Azure DB instance       |
| `AZURE_STORAGE_CONNECTION_STRING`       | Team's Blob Storage account | SAIT's Blob Storage account    |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Team's Azure Monitor        | SAIT's Azure Monitor workspace |

The handover package includes:

- All source code (Git repository)
- Docker Compose files for production
- `.env.example` with every required variable documented
- `DEPLOYMENT.md`: step-by-step provisioning and deployment
- `OPERATIONS_RUNBOOK.md`: common incidents and responses
- `ADMIN_GUIDE.pdf`: for the SAIT IT inheritor
- IT runbook for Entra ID app registration in the SAIT tenant
- DR runbook with tested restore procedure

---

## Ongoing IT Maintenance

The system is designed to minimize IT support burden.

- **Certificates:** renewed automatically by Caddy (ACME). No manual renewal.
- **Dependencies:** Renovate creates PRs for patches weekly. HIGH/CRITICAL CVEs must be patched within 7 days; the team demonstrates this process before handover.
- **Updates:** `git pull && docker compose pull && docker compose up -d` on the VM.
- **Monitoring:** Azure Monitor Alerts notify the Admin role on service failure, audit chain break, or disk pressure.
- **User management:** Add/remove users and assign roles via the Azure portal (Entra ID App Roles). No application admin panel required for this task.

---

## Questions SAIT IT May Have

**Does this require a GPU?**
No. The AI (Whisper) model does CPU inference. A 15-second voice clip transcribes in 3 to 5 seconds on a 4-core VM. No GPU-enabled VM is needed.

**Does this call any external AI APIs?**
No. The Whisper model runs in a Docker container on the SAIT VM. Audio never leaves SAIT infrastructure.

**Can it run on an existing VM or must it be dedicated?**
A dedicated VM is recommended. The AI model loads ~1.5 GB of RAM at startup. Sharing a VM with other services is possible if the VM has sufficient memory (minimum 8 GB available for this application).

**Is there a SaaS subscription or per-user fee?**
No. All application software is open source. The only recurring costs are Azure resource consumption (VM, database, blob storage, Azure Monitor). See `AZURE_COST_ESTIMATE.md` for a line-item estimate.

**What network access does the VM need?**
Inbound: HTTPS (443) and HTTP (80, redirected to HTTPS) from campus network or internet.
Outbound: Azure services (Entra ID JWKS endpoint, Blob Storage, Azure Monitor), Let's Encrypt ACME, GitHub (for updates).
All other inbound ports are closed.

---

_This document summarizes the system for infrastructure provisioning discussions. The full architectural specification is in `docs/ARCHITECTURE.md`._

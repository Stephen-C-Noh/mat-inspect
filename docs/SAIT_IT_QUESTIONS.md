# Handover Requirements for SAIT IT

**Project:** MAT-Inspect (MAT School Pre-Use Inspection System)
**Team:** Team Meridian (Capstone, Summer 2026)
**Context:** SAIT IT does not provision infrastructure during the capstone. This document is a handover package for SAIT IT to use when the School of MAT requests deployment. All items below are required before the system can go live with real SAIT staff data.

---

## 1. Hosting

- Provision a Linux VM with at least 8 GB RAM, 2 vCPU, 64 GB SSD. Ubuntu 24.04 LTS recommended.
- The team recommends Azure (Standard B2ms in Canada East or Canada Central) for alignment with SAIT's existing Microsoft infrastructure. A campus VM is equally viable; the Docker Compose stack runs identically on either.
- Grant one team member or designated SAIT admin SSH access for the initial deployment. After handover, SSH access transfers to SAIT IT.
- See AZURE_COST_ESTIMATE.md for Azure cost reference (~CAD $142-175/month for the full Azure-managed stack; less if running self-hosted Postgres and MinIO on the VM).

## 2. Authentication (Entra ID)

- Register the application in the SAIT Entra ID tenant (Azure portal > Entra ID > App registrations > New registration).
- Define 5 App Roles: `Operator`, `Supervisor`, `Manager`, `Admin`, `Auditor`.
- Set redirect URIs for the PWA and manager dashboard (provided in DEPLOYMENT.md).
- Assign SAIT staff accounts to the appropriate App Roles via the Azure portal.
- Note the `Tenant ID` and `Client ID`; these replace the team's dev tenant values in the production `.env` file. No code changes required.
- Lab Techs must have existing SAIT Entra ID accounts (confirmed: all are SAIT employees).

## 3. DNS and TLS

- Provision a subdomain for the system (e.g., `mat-inspect.sait.ca`) and point its A record at the VM's public IP.
- Caddy handles TLS automatically via Let's Encrypt once a public hostname resolves. No manual certificate management required from SAIT IT.

## 4. Security and Compliance

- A FOIP review of the system is recommended before go-live with real staff data. The system handles: operator names and emails, certification expiry dates, voice clips (biometric under FOIP), and inspection photos that may incidentally capture people. Contact SAIT's privacy office for a review checklist.
- SAIT IT should review the SECURITY.md in the handover package before deployment.
- An internal security review process for new web applications, if one exists at SAIT, should be applied before go-live.

## 5. Ongoing Maintenance

- Designate one SAIT IT staff member as the ongoing maintainer. That person should review the OPERATIONS_RUNBOOK.md and ADMIN_GUIDE.pdf from the handover package.
- Dependency updates: Renovate is configured in the repo and will open PRs for outdated packages. Someone needs to merge them.
- CVE SLA: HIGH or CRITICAL vulnerabilities with an available patch should be merged within 7 calendar days of detection (see OPERATIONS_RUNBOOK.md).
- Backup target: designate an off-host backup destination (NFS share, Azure Blob, or other) for nightly Postgres dumps and MinIO mirrors. The OPERATIONS_RUNBOOK.md documents the backup configuration.

## 6. Handover Checklist

Before the system goes live:

- [ ] VM provisioned and accessible via SSH
- [ ] Entra ID app registration created in SAIT tenant; App Roles defined
- [ ] Staff accounts assigned to App Roles
- [ ] DNS subdomain provisioned and pointing at VM
- [ ] Production `.env` file configured with SAIT tenant credentials and secrets
- [ ] `docker compose up` on the VM; all services healthy
- [ ] Smoke test: operator login, QR scan, checklist submission, supervisor approval, manager dashboard, PDF export
- [ ] Backup target configured; first backup verified
- [ ] Restore drill completed (per OPERATIONS_RUNBOOK.md)
- [ ] FOIP review completed or waived in writing by SAIT privacy office
- [ ] Maintainer has reviewed OPERATIONS_RUNBOOK.md and ADMIN_GUIDE.pdf

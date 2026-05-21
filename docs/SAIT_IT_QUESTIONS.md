# Questions for SAIT IT

**Project:** MAT-Inspect (MAT School Pre-Use Inspection System)
**Team:** Team Meridian (Capstone, Summer 2026)
**Deadline for answers:** End of Sprint 0 (May 31, 2026). Sprint 4 migration cannot proceed without these decisions confirmed.

---

## 1. Hosting

- Will SAIT IT provision the Azure resources (VM, PostgreSQL Flexible Server, Blob Storage, Key Vault, Azure Container Registry) and grant the team deploy access, or will SAIT IT hand the team a resource group to provision themselves and transfer ownership at handover?
- If Azure is not available, is a campus VM an option? What is the lead time?
- Specs required: 8 GB RAM, 2 vCPU, 64 GB SSD, Ubuntu 24.04 LTS. Estimated cost: CAD $135-165/month (see `docs/AZURE_COST_ESTIMATE.md` for full breakdown).
- What is the typical timeline to provision a new VM or cloud resource?

## 2. Authentication (Entra ID)

- Can the team register an application in the SAIT Entra ID tenant?
- The app registration needs: redirect URIs for the PWA and dashboard, and 5 App Roles defined (Operator, Supervisor, Manager, Admin, Auditor).
- Who at SAIT IT will own the app registration and assign roles to users or groups?
- Are Lab Techs SAIT employees with existing Entra ID accounts? (Confirmed in client meeting but needs IT-side verification.)

## 3. DNS and TLS

- Can SAIT IT provision a subdomain for the system (e.g., `mat-inspect.sait.ca`)?
- The team uses Caddy as the reverse proxy; it handles TLS via Let's Encrypt automatically once a public hostname is assigned. No manual certificate management required from SAIT IT.

## 4. Handover (August 15, 2026)

- At handover, will SAIT IT take ownership of the Azure subscription and rotate all credentials, or does the team transfer specific resource ownership?
- Who at SAIT IT will be the ongoing maintainer after handover? That person should attend at least the Sprint 6 demo and review the operations runbook before August 15.

## 5. Security and Compliance

- Is there an internal SAIT process for security review of new web applications before go-live?
- Does SAIT have a FOIP review checklist for new systems handling employee data? (Voice clips and inspection records contain staff PII.)
- Who is the SAIT FOIP/privacy officer to contact for the review?

## 6. Dev Staging

- The team uses a personally-owned mini-PC (accessible via Tailscale VPN) as a shared dev environment for Sprints 0-4. No SAIT data is stored on it. Is this acceptable?
- The team migrates to SAIT infrastructure at the end of Sprint 4 (week of July 26). SAIT IT provisioning must be complete before that date.

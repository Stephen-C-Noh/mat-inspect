# ADR 0016: No SAIT-Hosted Production; Capstone Delivers a Containerized Artifact and a Governance Package

Date: 2026-06-30
Status: Accepted
Amended by: ADR 0024 (adds a team-owned Azure demo deployment for the capstone; 0016's core decision, that the capstone does not depend on SAIT hosting, is unchanged)

## Context

SAIT ITS Cloud & Server Infrastructure replied on 2026-06-24 (Rudy Li, Supervisor) to the
project sponsor's hosting and architecture questions. ITS declined to host MAT-Inspect in the
SAIT Azure environment now, and gave no commitment for handover. The stated reasons:

- **Governance and ownership.** No approved Azure subscription model or capacity exists for
  student-developed capstone projects as production workloads. A production workload requires a
  named business owner, an operational owner, a funding model, and approval through existing
  governance processes.
- **Privacy and security.** The system stores voice recordings and operator identification, which
  may be personal information. ITS will not assess the privacy implications or validate what the
  student-built components collect, process, or store. A production deployment would require review
  by ITS Security, Privacy, and possibly Data Governance.
- **Support and operational ownership.** ITS provides infrastructure services, not development or
  ongoing support for custom student application code. A long-term owner and support model must
  exist first.
- **Cost and licensing.** Production hosting, storage, monitoring, backup, and security controls
  carry ongoing cost. No funding model is identified.
- **Lifecycle and risk.** Before production, SAIT would require documentation, source-code
  ownership, maintenance procedures, security review, change management, and vulnerability
  management to be clearly established.

ITS recommended that, if the sponsoring school wants to pursue the project past the capstone, the
school first identify a business owner and engage ITS Security, Privacy, and Enterprise
Architecture/Governance to evaluate adoption.

This reply formalizes the informal "no infrastructure access during the capstone" signal from
2026-05-25 and confirms the direction taken in DEV-70 (SAIT does not host; the project ships a
containerized API). It also changes the premise of ADRs 0003, 0004, and 0005, which assumed
Azure-managed production services inside a SAIT-operated tenant. That premise no longer holds for
the capstone.

## Decision

The capstone does not target a SAIT-hosted production deployment. The production target for the
capstone is the team-operated containerized stack (Docker Compose) on the team mini-PC. No
SAIT-hosted production runs during the capstone, and none is guaranteed at handover.

The capstone deliverable is two things:

1. A self-contained, reproducible containerized artifact: the full stack runs from the repository
   and the Docker Compose files, seeded with synthetic data, with no dependency on SAIT
   infrastructure.
2. A governance package: the documents ITS named as adoption prerequisites, assembled so a future
   SAIT business owner can take them into the ITS Security, Privacy, and Enterprise
   Architecture/Governance review without the capstone team.

Supporting points:

- **Entra ID stays on the personal tenant for the capstone.** The auth mechanism in ADR 0002 is
  unchanged; only the tenant differs. ITS gave no commitment to register the app, configure App
  Roles, or assign users in the SAIT tenant. A tenant swap happens only if the post-capstone
  governance track succeeds. The SAIT-tenant Entra registration runbook (part of DEV-44) is written
  for that future step, not executed during the capstone.
- **The Azure-managed production targets in ADRs 0003 (Azure Monitor), 0004 (Azure Blob Storage),
  and 0005 (Azure Database for PostgreSQL) become conditional on the post-capstone governance
  track, not capstone deliverables.** The dev and dev-staging setup (Azurite, self-hosted
  PostgreSQL, the Azure SDKs against emulators) is unchanged and remains the artifact's runtime.
  Those ADRs are not superseded; their production half is deferred until a business owner and
  funding exist.
- **AI Service usage-based autoscaling is deferred to the same post-handover track (ADR 0017).**
  The capstone runs the AI Service on the single mini-PC with a concurrency cap and resource
  reservation, not autoscaling. Autoscaling (Azure Container Apps with KEDA) is a post-adoption
  step, described in ADR 0017 and conditional on the governance track, not a capstone deliverable.
- **The Advisory Check runs on-prem and is FOIP-clean; the Azure Foundry conditions apply only if
  the team later upgrades to a cloud model (ADR 0018).** The delivered path runs the advisory model
  on the team mini-PC, so note text never leaves SAIT-controlled infrastructure and the feature
  works on real note text with no tenant gate. Azure Foundry is retained only as a conditional
  post-handover upgrade if the on-prem model's quality or throughput proves insufficient. If it is
  ever adopted, real note text may be sent to Foundry only after the SAIT tenant uses a Standard
  (regional) deployment in a Canada geography (not Global or DataZone) and approved modified abuse
  monitoring (ContentLogging=false). These two conditions are FOIP prerequisites for the Foundry
  upgrade and must be verified before it is turned on, not assumed.
- **Compliance is self-documented and defensible by design.** ITS will not assess privacy during
  the capstone, so the team documents it. Voice clips and operator identification stay on
  team-controlled (and, post-adoption, SAIT-controllable) storage. No voice clip, photo, or
  identifying inspection data goes to an external AI service (CLAUDE.md constraint, unchanged). The
  team produces a FOIP data-flow and retention document so a future reviewer can pick it up.

Governance package contents (each tracked by its own ticket):

- FOIP and privacy data-flow and retention document.
- Source-code ownership, license, and maintenance-responsibility statement.
- Vulnerability-management and change-management process documents.
- Governance adoption brief for the sponsoring school (the cover document that names the required
  business owner and frames the ITS Security/Privacy/Enterprise Architecture engagement).

The existing handover tickets stay valid and feed the package: DEV-44 (DEPLOYMENT, SECURITY,
OPERATIONS_RUNBOOK, Entra IT runbook), DEV-48 (role user guides), DEV-45 and DEV-49 (restore
drills), DEV-70 (API integration requirements).

## Consequences

Positive: the capstone delivery does not depend on SAIT infrastructure, a SAIT funding decision, or
an ITS committee timeline, none of which the team controls inside thirteen weeks. The artifact is
demonstrable on team hardware. The governance package strengthens the capstone on its own merits and
gives the sponsoring school a ready path to adoption. The decision is recorded in writing, so any
plan, demo, or stakeholder material that implied "live on SAIT Azure" is corrected to "deployable
artifact plus handover package."

Negative: production adoption is now an explicit post-capstone track gated on the school naming a
business owner, which the team does not control. The Azure-managed production design in ADRs 0003 to
0005 is built and documented but not exercised in a real SAIT production environment during the
capstone, so its first true production run happens later, under a future owner. The team carries the
documentation cost of the governance package on top of feature work.

## Alternatives Considered

- **Press ITS to host the capstone in SAIT Azure now.** Rejected. ITS declined in writing and named
  prerequisites (business owner, funding, governance review) that cannot be met inside the capstone.
  Pursuing this blocks delivery on decisions the team does not own.
- **Ship the artifact with no governance package.** Rejected. ITS listed the exact documents a
  future adoption requires. Producing them during the capstone costs a few documentation tickets and
  is the difference between a dead-end demo and an adoptable system. Most of these documents are
  expected capstone deliverables regardless.
- **Host a real production instance on a third-party cloud under a team account.** Rejected. Voice
  clips and operator identification are personal information under FOIP and must stay on
  SAIT-controllable infrastructure. A team-owned cloud account has no business owner, no funding
  model, and no SAIT privacy review, which reproduces every problem ITS raised.

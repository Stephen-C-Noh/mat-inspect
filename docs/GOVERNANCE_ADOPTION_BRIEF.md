# Governance Adoption Brief

This brief is the cover document of the MAT-Inspect governance package. It is written for the
sponsoring school (SAIT's School of Manufacturing and Automation Technology) to take to SAIT ITS if
the school decides to pursue MAT-Inspect past the capstone. It summarizes what the system is, what
adoption requires, and where each supporting document lives. It is not a decision to adopt; that
decision, and the ITS engagement it triggers, belong to the school and a named business owner (ADR
0016).

---

## 1. What MAT-Inspect is

MAT-Inspect is a digital pre-use inspection system for high-risk equipment at SAIT Main Campus
(overhead cranes, trucks, an electric pallet jack, and forklifts). It replaces paper inspection
sheets with a mobile web app (PWA) for operators, voice-to-text defect notes transcribed on-premise,
a manager dashboard, and a tamper-evident, hash-chained audit log. It is built to satisfy the
Alberta OHS requirement (s.257 and the Part 6 log-book rule) that a competent human operator
performs and is identified on every inspection. The AI features are assistive only: they transcribe
voice and can suggest defect categories, and they never pass or fail an inspection.

The capstone delivers a self-contained, reproducible containerized artifact (the full stack runs
from this repository and its Docker Compose files, on synthetic data, with no dependency on SAIT
infrastructure) plus this governance package. The system is designed so SAIT can later self-host the
stack or deploy it to its own Azure infrastructure with no redesign (ADR 0016).

---

## 2. What adoption requires

SAIT ITS (reply 2026-06-24) declined to host MAT-Inspect during the capstone and stated that, to
pursue it past the capstone, the sponsoring school must first establish the following and engage ITS
Security, Privacy, and Enterprise Architecture/Governance to evaluate adoption:

- **A named business owner** in the school who owns the decision and the relationship with ITS.
- **A named operational owner** responsible for running, patching, and supporting the deployment.
- **A funding model** for hosting, storage, monitoring, backup, and security controls.
- **Governance approval** through SAIT's existing processes, including Security, Privacy, and Data
  Governance review of the personal information the system handles.

The capstone team does not own any of these. This package exists to make the school's path through
that review as short as possible: it supplies the documents ITS named as prerequisites, assembled so
a future business owner can carry them into the ITS engagement without the capstone team.

---

## 3. The governance package

| Prerequisite ITS named                      | Document                                                                      | Ticket         |
| ------------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| Decision record for the whole package       | `docs/adr/0016-no-sait-hosted-production-artifact-and-governance-package.md`  | DEV-86         |
| FOIP and privacy data-flow and retention    | `docs/PRIVACY_DATA_FLOW.md`                                                   | DEV-76         |
| Source-code ownership, license, maintenance | `docs/OWNERSHIP_AND_LICENSE.md`, `LICENSE`                                    | DEV-77         |
| Vulnerability management                    | `docs/VULNERABILITY_MANAGEMENT.md`                                            | DEV-78         |
| Change management                           | `docs/CHANGE_MANAGEMENT.md`                                                   | DEV-78         |
| Security controls                           | `SECURITY.md`                                                                 | DEV-44         |
| Deployment on a fresh host                  | `docs/DEPLOYMENT.md`                                                          | DEV-44         |
| Day-two operations                          | `docs/OPERATIONS_RUNBOOK.md`                                                  | DEV-44         |
| Restore-drill evidence                      | `docs/OPERATIONS_RUNBOOK.md` section 6, `docs/runbooks/backup-and-restore.md` | DEV-45, DEV-49 |
| Role user guides                            | `docs/OPERATOR_GUIDE.md`, `docs/SUPERVISOR_GUIDE.md`, `docs/ADMIN_GUIDE.md`   | DEV-48         |
| API integration requirements                | `docs/API_INTEGRATION_REQUIREMENTS.md`                                        | DEV-70         |
| What a SAIT-hosted target would provision   | `docs/SAIT_IT_BRIEF.md`                                                       | DEV-44         |

The architectural source of truth for the whole system is `docs/ARCHITECTURE.md`.

---

## 4. Open items gated on a SAIT decision

These cannot be settled by the capstone team; they depend on decisions the school and ITS make at
adoption. They are listed so the review starts with them in view, not so the team resolves them.

- **Identity tenant.** The capstone runs authentication on a project-owned Entra (Azure AD) tenant,
  not SAIT's (ADR 0016). Adoption requires registering the application in a SAIT tenant: the App
  Roles, the SPA redirect URIs, and the resulting tenant id, client id, token audience, and issuer
  values. These are the integration inputs described in `docs/API_INTEGRATION_REQUIREMENTS.md` and
  the step-by-step registration in `docs/runbooks/azure-deployment-and-entra-setup.md` (Part A). The
  registration runbook is written for this step and is not executed during the capstone.
- **Hosting target and Azure resources.** The delivered artifact runs on a team-operated Docker
  Compose host. A SAIT-hosted deployment would provision Azure Database for PostgreSQL, an Azure
  Blob Storage account, and Application Insights, listed in `docs/SAIT_IT_BRIEF.md`. The design keeps
  these in scope (ADRs 0003 to 0005); their production half is deferred to this track, not cancelled.
- **Privacy determination.** ITS will not assess privacy during the capstone. `docs/PRIVACY_DATA_FLOW.md`
  gives the reviewer the data-flow and retention facts; the FOIP determination itself is ITS and the
  school's to make. One item to settle there is whether a future owner enables raw voice-clip
  persistence, which changes the retention posture (see that document).
- **Operational ownership and funding.** Named above in section 2; no capstone deliverable can
  substitute for them.

---

## 5. Status

The governance package documents listed in section 3 exist in the repository. This brief and the
package are to be reviewed with the project sponsor before handover, and are then ready to hand to
the school. The capstone provides no maintenance after handover (see `docs/OWNERSHIP_AND_LICENSE.md`
section 4); the package is the school's starting point for the ITS engagement, delivered as-is.

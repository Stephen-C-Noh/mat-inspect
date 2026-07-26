# ADR 0024: Team-Owned Azure Demo Deployment on Azure Container Apps

Date: 2026-07-25
Status: Accepted
Amends: ADR 0016 (adds a team-owned Azure demo; does not reverse 0016's core decision)
Relates to: ADR 0017 (brings the deferred Azure Container Apps target forward for the demo),
ADR 0020 (Front Door plays the single-front-door role Caddy plays elsewhere; the invariants hold)

## Context

ADR 0016 recorded that the capstone does not target a SAIT-hosted production deployment, and that the
Azure-managed production halves of ADRs 0003 (Azure Monitor), 0004 (Azure Blob Storage), and 0005
(Azure Database for PostgreSQL) were deferred to a post-capstone governance track, built but never
exercised in a real Azure environment.

Leaving those halves unexercised until after handover has two costs: the first real production run
happens under a future owner with no team member present, and the DEV-44 handover documents would be
hypotheticals. The team already owns an Azure tenant (the `lowell2753` personal tenant, `fa517e85`,
subscription `cbdba940`) that holds the Entra app registration (ADR 0002) and the Application
Insights workspace (ADR 0003). Standing up the rest of the stack there for the live demo, on
synthetic data, de-risks both costs.

The FOIP constraint that drove "SAIT-controlled infrastructure" (ADR 0016) is about real data, not
compute location. The demo runs on synthetic seed data, so no real biometric PII (voice clips) or
operator identification exists to protect.

The remaining question was the compute model. A single VM running the full Docker Compose stack was
considered first and rejected: the team does not want to operate a VM for the whole stack, and it
does not exercise Azure's managed compute. Azure Container Apps (ACA) is the managed serverless
container platform ADR 0017 already named as the post-handover target. Bringing it forward for the
demo is a better fit than a VM and proves the managed compute path, not only the managed data path.

## Decision

Deploy the stack to the team-owned `lowell2753` Azure tenant for the live demo, on Azure Container
Apps, with Azure Front Door as the edge. This is a demo and de-risking exercise, not a production
adoption. ADR 0016's core decision holds: the capstone does not depend on SAIT hosting, and no
SAIT-hosted production runs. What changes is that the managed compute and data path is exercised once,
on team-owned Azure, before handover.

Specifics:

- **Tenant and region.** The existing `lowell2753` tenant. All resources in Canada Central for data
  residency. No new Entra app registration; the current one gains the Front Door custom-domain
  hostnames as SPA redirect URIs.
- **Compute is Azure Container Apps.** Each service is its own container app in one ACA environment:
  `core-api`, `media`, `audit`, `ai`, `pwa`, `dashboard`. There is no VM and no Docker Compose in the
  Azure deployment. The ACA environment binds a Log Analytics workspace, which is the Azure Monitor
  sink (ADR 0003).
- **Edge is Azure Front Door.** Front Door terminates TLS, serves the custom domains, and does the
  path-based routing that Caddy does elsewhere: `/api/v1/media/*` to `media`, `/api/v1/reports/*` to
  `audit`, `/api/v1/*` to `core-api`, and `/*` to the front end. Requests stay same-origin, so there
  is no CORS surface. This plays the single-front-door role of ADR 0020; the invariants of ADR 0020
  are preserved, only the implementation differs (Front Door plus ACA ingress instead of Caddy). The
  two front ends keep separate origins so their MSAL caches do not share storage (ADR 0020).
- **The AI Service has no public route.** The `ai` app uses ACA internal ingress, so it is reachable
  only from other apps in the environment (core-api proxies to it, ADR 0019), never from the internet.
  This preserves the ADR 0019/0020 rule without a reverse proxy. The audio it receives is biometric
  PII and never leaves the environment.
- **The AI Service is self-hosted and always warm.** The delivered model is our own faster-whisper
  and on-prem SLM (ADR 0017, ADR 0018) running in our own container image. Running our own model on
  our own container app is not use of a managed AI service, so the Azure OpenAI / Foundry data terms
  (which need an organization tenant and are unavailable on a personal tenant) do not apply. The `ai`
  app is pinned to `min-replicas: 1` so the model stays loaded and there is no scale-to-zero cold
  start. Model weights are delivered through an Azure Files mount (ACA has no host bind mount, so the
  host-mount design in `docs/runbooks/ai-model-weights.md` is replaced by an Azure Files share for
  this deployment). No audio is sent to any external AI API (ADR 0016, ADR 0018, CLAUDE.md).
- **Data tier is managed.** Azure Blob Storage replaces Azurite, Azure Database for PostgreSQL
  Flexible Server replaces the self-hosted `postgres` container, Azure Monitor is the ACA environment's
  Log Analytics workspace plus the existing Application Insights.
- **Synthetic data only (hard guardrail).** Seeded from `db/seed.ts` and canned audio. No real
  operator voice clips, names, emails, or inspection records. On a personal tenant the infrastructure
  is team-controlled, not SAIT-controlled, so real PII would violate ADR 0016.
- **Bounded lifetime.** The environment runs through the capstone end (2026-08-21) and is then torn
  down. This bounds spend and leaves no unowned personal-tenant deployment holding data.

The DEV-44 handover documents are written from this deployment. Moving to a SAIT-hosted deployment is
a configuration change: repeat the Entra registration in the SAIT tenant, point connection strings at
SAIT's managed resources, and recreate the ACA environment and Front Door in the SAIT subscription.
No application code change is required (ADR 0016).

## Consequences

Positive: the managed compute and data path is exercised end to end before handover, on the platform
ADR 0017 already targets. There is no VM to patch or operate; ACA and Front Door are managed. The
AI Service stays private through ACA internal ingress rather than through a hand-maintained proxy or
network rule. The DEV-44 documents are written from a real deployment.

Negative: the demo incurs about one month of Azure spend on the team's personal account, including
the Front Door resource. The deployment runs on a personal tenant, not SAIT-controlled infrastructure,
which is acceptable only because the demo data is synthetic. ACA introduces platform specifics the
Compose deployment does not have: per-app resource caps (4 vCPU and 8 GB on the Consumption plan, no
GPU), Azure Files weight delivery for the AI app instead of the host bind mount, and Front Door route
configuration for the path split. Teardown is a required step, not optional.

## Alternatives Considered

- **Single VM running the full Docker Compose stack.** Rejected. The team does not want to operate a
  VM for the whole stack, and it does not exercise Azure's managed compute. ACA is managed and is the
  ADR 0017 target.
- **Keep everything on the mini-PC with Azurite and self-hosted PostgreSQL (ADR 0016 as written).**
  Rejected for the demo. It never exercises the managed path, so the first production run happens
  post-handover under a future owner, and the DEV-44 runbooks stay hypothetical.
- **A gateway container app running Caddy in front of the other apps.** Rejected. It works and would
  reuse the Caddy config verbatim, but Front Door is the Azure-native edge and removes a
  hand-maintained proxy. Caddy remains the front door for the non-Azure artifact (dev, mini-PC).
- **Per-service subdomains, no central router.** Rejected. It removes the router but makes the browser
  call several origins, which adds a CORS surface and front-end configuration changes. Front Door
  keeps requests same-origin.
- **AI Service on a dedicated VM, other services on ACA (hybrid).** Rejected. It gives the AI tier
  predictable resources and a GPU path, but it reintroduces a VM and requires VNet-integrated ACA plus
  an NSG so only the ACA subnet can reach the auth-less AI port, which is a security-critical piece of
  network configuration. ACA `min-replicas: 1` removes the cold-start problem that motivated the VM,
  and ACA internal ingress keeps the AI Service private without a VNet rule. If CPU latency proves
  unacceptable at demo scale, an ACA Dedicated GPU workload profile is the in-platform escape hatch
  before a VM.
- **Azure managed AI service (Azure OpenAI / Foundry) instead of the self-hosted model.** Rejected.
  Its FOIP-safe use needs an organization tenant with modified abuse monitoring and a Canada-region
  deployment (ADR 0016, ADR 0018), which a personal tenant cannot obtain.
- **Fresh tenant (for example a stephen.c.noh tenant).** Rejected. It would duplicate the Entra app
  registration, the API scope, the five App Roles, and the role assignments that already exist on the
  `lowell2753` tenant, for no benefit.

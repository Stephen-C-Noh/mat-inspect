# MAT-Inspect

MAT-Inspect is a digital pre-use inspection system for high-risk equipment at SAIT Main Campus
(overhead cranes, trucks, an electric pallet jack, and forklifts). It replaces paper inspection
sheets with a mobile web app (PWA) for operators, on-premise voice-to-text defect notes, a manager
dashboard, and a tamper-evident, hash-chained audit log. It is built to satisfy the Alberta OHS
requirement (s.257 and the Part 6 log-book rule) that a competent human operator performs and is
identified on every inspection. The AI features are assistive only: they transcribe voice and can
suggest defect categories, and they never pass or fail an inspection.

Capstone project, Team Meridian, SAIT MAT (Manufacturing, Automation, Transportation) School,
Summer 2026.

## What is in this repository

The full self-contained containerized stack:

- `apps/pwa` operator PWA and `apps/dashboard` manager dashboard (Next.js)
- `services/core-api`, `services/media`, `services/audit` (Node.js + Fastify), `services/ai`
  (Python + FastAPI: Whisper transcription and the assistive defect-category model)
- `db/` Drizzle schema, migrations, and a synthetic seed
- `packages/` shared auth, schemas, types, and design tokens
- `docker-compose.yml` and `infra/` Caddy config for the full local stack

It runs from a clean checkout on synthetic data, with no dependency on SAIT infrastructure. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design.

## Live demo

A demo runs on Azure (team-owned tenant, synthetic data only):

- Operator PWA: https://mat-inspect-pwa-cpacesfdf2frgnaw.z01.azurefd.net
- Manager dashboard: https://mat-inspect-dashboard-hpfnb8b5cfbjereu.z01.azurefd.net

Both require an Azure Entra ID sign-in. Evaluation credentials are provided with the submission,
not stored in this repository.

## Running the project

Prerequisites: Docker Desktop, Node 22 LTS, Git.

```bash
git clone https://github.com/Stephen-C-Noh/mat-inspect.git
cd mat-inspect
```

The stack authenticates against Azure Entra ID (Azure AD) and validates its configuration on boot:
by design it will not start with blank or placeholder values (ADR 0015). To bring it up:

1. Copy `.env.example` to `.env` and fill in the Entra values (tenant id, client id), the
   Application Insights connection string, and the audit-service token. The step-by-step Entra app
   registration is in
   [docs/runbooks/azure-deployment-and-entra-setup.md](docs/runbooks/azure-deployment-and-entra-setup.md)
   (Part A).
2. Follow [docs/QUICKSTART.md](docs/QUICKSTART.md) for the bring-up order, the database
   migrate/seed step, and the difference between running the full Docker stack and iterating on one
   app with `npm run dev`.
3. All seed data is synthetic (`db/seed.ts`); no real personal data is included.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - system design (source of truth)
- [PRD.md](docs/PRD.md) and [FRS.md](docs/FRS.md) - product and feature specifications
- [API_REFERENCE.md](docs/API_REFERENCE.md) - endpoint reference
- [CODING_STANDARDS.md](docs/CODING_STANDARDS.md) and [CONTRIBUTING.md](docs/CONTRIBUTING.md) -
  code style and git workflow
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) and [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) -
  deployment on a fresh host and day-two operations
- [GOVERNANCE_ADOPTION_BRIEF.md](docs/GOVERNANCE_ADOPTION_BRIEF.md) - index of the governance
  package prepared for handover

## Team

Team Meridian, five students. Area ownership is in [.github/CODEOWNERS](.github/CODEOWNERS).

| Name                  | GitHub          |
| --------------------- | --------------- |
| Stephen Changbeom Noh | @Stephen-C-Noh  |
| Adan Hernandez        | @4d4n-HDZ       |
| Enzo Campana Torres   | @Enzodabenzo123 |
| Fathema Begum Ema     | @fathema25      |
| Sophia Canonizado     | @Sophia110806   |

## Sponsor

SAIT School of Manufacturing, Automation, and Transportation (MAT).

## License

MIT. See [LICENSE](LICENSE).

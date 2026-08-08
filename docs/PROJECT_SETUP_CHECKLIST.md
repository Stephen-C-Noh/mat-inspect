# Project Setup Checklist: Solo Prep Before Inviting Teammates

**Purpose:** Build a working baseline so teammates are productive on day one
**Audience:** Stephen (solo prep work)
**Time budget:** Roughly 25 hours, spread across 2 weekends + some weeknight time
**Outcome:** A teammate can clone the repo, run `docker compose up`, and have the full stack working in under 15 minutes

---

## Priority Tiers

- **Tier 1 (Must do before inviting):** Without these, teammates cannot start. ~12 hours
- **Tier 2 (Strongly recommended):** Big productivity gain on day one for the team. ~8 hours
- **Tier 3 (Can defer to Sprint 0 with team):** Useful but team can help build it in Week 1. ~5 hours

If pressed for time: do all of Tier 1, do as much Tier 2 as possible, defer Tier 3.

---

# TIER 1: MUST DO BEFORE INVITING (~12 hours)

## 1.1 Create the GitHub Repository (~1 hour)

- [ ] Create new GitHub repo: `mat-inspect` (private until decision otherwise)
- [ ] Set default branch to `main`
- [ ] Add MIT or Apache-2.0 license (check with the capstone instructor on preferred license for SAIT projects)
- [ ] Enable Issues, disable Wikis (use repo docs instead), disable Discussions (use Issues)
- [ ] Configure branch protection on `main`:
  - Require PR before merge
  - Require at least 1 approval
  - Require status checks (will configure after CI is set up)
  - Dismiss stale reviews when new commits are pushed
  - Require linear history (rebase or squash only)
  - Block force push
- [ ] Create labels: `bug`, `feature`, `chore`, `security`, `compliance`, `docs`, `blocked`, `good-first-issue`, `sprint-0`, `sprint-1`, ..., `sprint-7`
- [ ] Create milestones: `Sprint 0`, `Sprint 1`, ... `Sprint 7`
- [ ] Initial commit on `main` with just a README placeholder

## 1.2 Add Documentation to /docs (~30 minutes)

The docs we have produced go in the repo so teammates can read before contributing.

- [ ] Create `/docs/` directory
- [ ] Add `ARCHITECTURE.md` (the Capstone Plan)
- [ ] Add `PRD.md`
- [ ] Add `FRS.md`
- [ ] Add `API_REFERENCE.md`
- [ ] Add `CODING_STANDARDS.md`
- [ ] Add `CONTRIBUTING.md`
- [ ] Add `AI_USAGE_GUIDE.md`
- [ ] Add `CLIENT_MEETING_QUESTIONS.md` (this doc; useful reference)
- [ ] Add `/CLAUDE.md` to repo root (auto-loaded by Claude Code)
- [ ] Add `/docs/adr/` directory with `0000-template.md` (ADR template)

## 1.3 Write the README (~1 hour)

The README is what a new teammate sees first. Keep it focused.

````markdown
# MAT-Inspect

Pre-use inspection system for SAIT's MAT (Manufacturing, Automation, Transportation) School.
Capstone project, Team Meridian, Summer 2026.

## Quick Start

Prerequisites: Docker Desktop, Node 22 LTS, Git.

```bash
git clone https://github.com/<org>/mat-inspect.git
cd mat-inspect
cp .env.example .env
docker compose up
```
````

Open http://localhost:3000 for the operator PWA.
Open http://localhost:3001 for the manager dashboard.

## New Teammate? Read These in Order

1. [CONTRIBUTING.md](docs/CONTRIBUTING.md) - Git workflow
2. [CODING_STANDARDS.md](docs/CODING_STANDARDS.md) - Code style
3. [AI_USAGE_GUIDE.md](docs/AI_USAGE_GUIDE.md) - AI tools policy
4. [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design
5. [PRD.md](docs/PRD.md) - What we are building and why
6. [FRS.md](docs/FRS.md) - Feature specifications
7. [API_REFERENCE.md](docs/API_REFERENCE.md) - Endpoint reference

## Team

- 5 students, see CODEOWNERS for area ownership.

## Sponsor

SAIT School of Manufacturing, Automation, and Transportation.

## License

[MIT or Apache-2.0]

````

- [ ] Replace `<org>` with actual GitHub org or username
- [ ] Adjust ports if any conflict on your machine
- [ ] Commit and push

## 1.4 Create the Monorepo Skeleton (~3 hours)

The directory structure from CODING_STANDARDS.md, but empty.

- [ ] Initialize repo with npm workspaces:

```json
// package.json (root)
{
  "name": "mat-inspect",
  "version": "0.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "services/*",
    "packages/*"
  ],
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "type-check": "tsc -b",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "build": "tsc -b",
    "prepare": "husky install"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "prettier": "^3.3.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "vitest": "^2.0.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0"
  }
}
````

- [ ] Create root `tsconfig.base.json` with strict settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "resolveJsonModule": true
  }
}
```

- [ ] Create root `.eslintrc.cjs` with project-wide rules (matches CODING_STANDARDS.md)
- [ ] Create root `.prettierrc.json` with `{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }`
- [ ] Create `.gitignore` covering `node_modules`, `.env`, `dist`, `.next`, `*.log`, OS-specific files
- [ ] Create `.nvmrc` with `22`
- [ ] Create `.editorconfig` for cross-IDE consistency
- [ ] Create empty directories:

```
apps/pwa/
apps/dashboard/
services/core-api/
services/media/
services/audit/
services/ai/
packages/shared-schemas/
packages/shared-types/
packages/shared-utils/
db/schema/
db/migrations/
infra/caddy/
infra/docker/
.github/workflows/
```

- [ ] Add `.gitkeep` files to empty directories so they get committed
- [ ] Commit: "chore: initialize monorepo skeleton"

## 1.5 Docker Compose with Working Stubs (~4 hours)

The point of this step: a teammate clones, runs `docker compose up`, and sees green health checks for every container.

- [ ] Create `/docker-compose.yml` at repo root with:
  - Postgres 16 container with an init script creating two databases: `core_db`, `audit_db`
  - Azurite container with two pre-created blob containers: `mat-inspect-media`, `mat-inspect-reports`
  - Caddy 2 container with reverse proxy config
  - 4 service stubs (core-api, media, audit, ai) each returning `{ "status": "ok" }` on `/health`
  - 2 app stubs (PWA, dashboard) showing "Hello, MAT-Inspect"

- [ ] Each service has a minimal Dockerfile (multi-stage build, non-root user)
- [ ] Postgres init script: `infra/docker/postgres-init.sql`
- [ ] Caddy config: `infra/caddy/Caddyfile` routing each hostname to the right container

- [ ] `.env.example` at repo root with all required variables (placeholders, never real secrets):

```
POSTGRES_USER=mat
POSTGRES_PASSWORD=changeme
POSTGRES_DB=postgres

# Obtain from the Entra ID app registration in the Azure portal (SAIT IT)
ENTRA_TENANT_ID=REPLACE_ME
ENTRA_CLIENT_ID=REPLACE_ME

# Azurite (Azure Storage emulator) in dev; the well-known dev shortcut connection string
AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true

# CORE_API_DB_URL is core-api's runtime connection: the core_api_writer role (SELECT/INSERT/
# UPDATE, no DELETE, not the owner of the immutability triggers; DEV-146), not the admin role.
# Migrations run separately as core_api_migrator via CORE_MIGRATOR_DB_URL. Same split as audit_db
# below (audit_writer for AUDIT_API_DB_URL, audit_migrator for AUDIT_MIGRATOR_DB_URL).
CORE_API_DB_URL=postgresql://core_api_writer:changeme@postgres:5432/core_db
CORE_MIGRATOR_DB_URL=postgresql://core_api_migrator:changeme@postgres:5432/core_db
AUDIT_API_DB_URL=postgresql://audit_writer:changeme@postgres:5432/audit_db
AUDIT_MIGRATOR_DB_URL=postgresql://audit_migrator:changeme@postgres:5432/audit_db
```

- [ ] Verify: `docker compose up` succeeds; all containers show healthy after ~60 seconds
- [ ] Verify: each `/health` endpoint returns 200
- [ ] Commit: "feat: initial docker compose with service stubs"

## 1.6 Issue Templates and PR Template (~30 minutes)

- [ ] Create `.github/ISSUE_TEMPLATE/bug.md`, `feature.md`, `task.md`
- [ ] Create `.github/PULL_REQUEST_TEMPLATE.md` matching the template in CONTRIBUTING.md
- [ ] Create `.github/CODEOWNERS`:

```
# Default: anyone on the team can review
* @stephen-c-noh

# Security-sensitive: requires 2 reviewers
/services/audit/  @stephen-c-noh @teammate-backend-lead
/services/core-api/src/middleware/auth.ts  @stephen-c-noh @teammate-backend-lead
/services/core-api/src/domain/inspection.ts  @stephen-c-noh @teammate-backend-lead
/db/migrations/  @stephen-c-noh @teammate-backend-lead
```

Replace `@teammate-backend-lead` once you know which teammate it is.

## 1.7 First ADR (~1 hour)

- [ ] Create `/docs/adr/0001-monorepo-microservices.md`:

```markdown
# ADR 0001: Monorepo with npm Workspaces; Microservices at Runtime

Date: 2026-05-18
Status: Accepted

## Context

Capstone team of 5, 13 weeks, building a microservices system with shared types
between PWA, dashboard, and backend services.

## Decision

Use a single Git repository (monorepo) with npm workspaces. At runtime, build and
deploy as separate Docker containers (microservices).

## Consequences

Positive: atomic cross-service changes; shared schemas with no publishing overhead;
single CI config; one handover artifact for SAIT IT.
Negative: clone size grows; needs care to keep service boundaries clean (services
import only from packages/, never from other services).

## Alternatives Considered

Polyrepo per service: rejected because cross-service changes are common in this
project and the team is small enough that coordination overhead exceeds benefits.
See https://github.com/<repo>/issues/<discussion-link> for full reasoning.
```

- [ ] Commit: "docs: add ADR-0001 monorepo with microservices runtime"

## 1.8 Onboarding Doc for Teammates (~1.5 hours)

This is the single most important doc for day 1.

- [ ] Create `/docs/ONBOARDING.md`:

```markdown
# Welcome to Team Meridian

Welcome aboard. This is your day-1 to day-3 checklist. If anything is broken,
ping the chat; do not silently struggle.

## Day 1 (Aim for 2 hours)

- [ ] Confirm you have GitHub access to the repo
- [ ] Confirm you can clone:
      git clone https://github.com/<org>/mat-inspect.git
- [ ] Install prerequisites: Docker Desktop, Node 22 LTS, Git
- [ ] Run the stack: cp .env.example .env && docker compose up
- [ ] Open http://localhost:3000 and confirm "Hello, MAT-Inspect"
- [ ] Open all /health endpoints; confirm 200s
- [ ] Read the four onboarding docs in order: 1. CONTRIBUTING.md (git workflow) 2. CODING_STANDARDS.md (code style) 3. AI_USAGE_GUIDE.md (AI tools policy) 4. ARCHITECTURE.md (system design overview)

## Day 2 (Aim for 2 hours)

- [ ] Set up Bitwarden access (Stephen will send invite link)
- [ ] Set up Tailscale access for dev staging
- [ ] Skim PRD.md and FRS.md
- [ ] Open your first issue in the Sprint 0 milestone; comment to claim it
- [ ] Create your first branch and PR (even if trivial, e.g., adding your name to
      the README contributors section). This exercises the full workflow.

## Day 3 and Beyond

- [ ] Pair with another teammate on a real feature
- [ ] Attend daily standup (15 min)
- [ ] Submit your first real feature PR

## If You Get Stuck

- Stack does not start: check Docker Desktop is running; check ports 3000, 3001,
  5432, 8080, 9000 are free; ask in chat.
- Cannot access GitHub: Stephen, the repo owner, can add you.
- Cannot access Bitwarden: Stephen sends invite.
- Cannot access Tailscale: Stephen sends invite.
- Cannot understand a doc: ask in chat. If it is unclear, the doc is wrong.
```

- [ ] Commit: "docs: add ONBOARDING.md for new teammates"

---

# TIER 2: STRONGLY RECOMMENDED (~8 hours)

## 2.1 CI Pipeline (~2 hours)

A green CI on first PR is a massive morale boost.

- [ ] Create `.github/workflows/ci.yml`:
  - Triggers on pull_request and push to main
  - Jobs: lint, type-check, test, build
  - Uses Node 22, caches npm
  - Runs on ubuntu-latest

- [ ] Add status check requirements to branch protection
- [ ] Open a test PR (against an empty branch) and verify CI runs green
- [ ] Commit: "ci: add lint, type-check, test, build workflow"

## 2.2 Security Scanning in CI with Explicit Severity Gates (~2 hours)

The point is not just to run scans; it is to **fail the build** on real findings. Every gate below is configured with an explicit severity threshold so the team cannot accidentally merge HIGH-severity issues.

- [ ] Add Trivy job (`aquasecurity/trivy-action`) with `severity: HIGH,CRITICAL` and `exit-code: 1` so the build fails on findings
- [ ] Add Semgrep job (`returntocorp/semgrep-action`) with `config: p/owasp-top-ten p/security-audit` and fail on HIGH severity
- [ ] Add Gitleaks job (`gitleaks/gitleaks-action`) running full history scan; any finding fails the build
- [ ] Add `npm audit --audit-level=high` step that fails the build (with exception process documented in `docs/security-exceptions.md`)
- [ ] Add **Hadolint** job (`hadolint/hadolint-action`) on every Dockerfile in the repo; fail on any error or warning
- [ ] Configure GitHub branch protection so all six security checks (Trivy, Semgrep, Gitleaks, npm-audit, Hadolint, plus the lint/type/test/build checks from 2.1) are required before merge
- [ ] Commit: "ci: add enforced security gates with explicit severity thresholds"

## 2.3 Dependency Management Bot (~30 minutes)

- [ ] Enable Renovate (preferred) or Dependabot on the repo
- [ ] Configure to group patch and minor updates into weekly PRs
- [ ] Configure auto-merge after CI passes for patch and minor updates
- [ ] Major updates require human review (default behavior)
- [ ] Create a GitHub Project board "Security Triage" with columns: New, In Review, Patching, Verified
- [ ] Commit: "chore: enable Renovate with auto-merge for patch and minor"

## 2.4 Pre-Commit Hooks (~1 hour)

- [ ] Install Husky: `npm run prepare` after `npm install`
- [ ] Add lint-staged config to `package.json`:

```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{md,json,yaml,yml}": ["prettier --write"],
  "*.py": ["ruff format", "ruff check --fix"],
  "Dockerfile*": ["hadolint"]
}
```

- [ ] Add Husky `pre-commit` hook running `lint-staged`
- [ ] Add Husky `pre-commit` hook running `gitleaks protect --staged`
- [ ] Test: try committing with a syntax error; confirm it is blocked
- [ ] Test: try committing with a fake AWS key; confirm Gitleaks blocks it
- [ ] Test: try committing a Dockerfile with `USER root`; confirm Hadolint blocks it
- [ ] Commit: "chore: add pre-commit hooks for lint, secrets, and Dockerfile lint"

## 2.5 Dev Staging on M5 Plus (~2 hours)

- [ ] On M5: create `~/projects/mat-inspect/` directory
- [ ] Clone the repo there
- [ ] `cp .env.example .env`; fill in real (project-specific) secrets
- [ ] `docker compose up -d`
- [ ] Verify Caddy local CA generates root cert: `docker compose exec caddy caddy trust`
- [ ] Copy root cert to `~/staging-root-ca.crt` for distribution
- [ ] Test: from your laptop, install root cert, hit `https://mat-inspect.staging`, confirm green padlock with no warnings
- [ ] In Tailscale admin, create a tag `tag:mat-inspect-staging` and an ACL allowing teammates to reach the M5 on ports 80/443 only
- [ ] Confirm M5 is reachable from your laptop over Tailscale

## 2.6 GitHub Actions Deploy to M5 (~1.5 hours)

- [ ] Generate a fresh SSH key pair on M5 for deploys only (`ssh-keygen -t ed25519 -f ~/.ssh/github_actions_deploy`)
- [ ] Add public key to M5's `~/.ssh/authorized_keys`
- [ ] In GitHub repo settings, add secrets:
  - `STAGING_HOST` = M5's Tailscale IP or hostname
  - `STAGING_USER` = SSH user
  - `STAGING_SSH_KEY` = private key contents
- [ ] Create `.github/workflows/deploy-staging.yml`:
  - Triggers on push to main
  - SSH to M5 and run `cd ~/projects/mat-inspect && git pull && docker compose pull && docker compose up -d`
- [ ] Test: push a trivial change to main; confirm the deploy runs and the new code is live on staging
- [ ] Commit: "ci: add deploy-staging workflow targeting M5 over Tailscale"

---

# TIER 3: NICE TO HAVE (~5 hours)

## 3.1 Shared Packages Initialized (~1 hour)

- [ ] `packages/shared-types/`: create `package.json` and `src/index.ts` with placeholder types
- [ ] `packages/shared-schemas/`: create `package.json` and `src/index.ts` with a placeholder Zod schema
- [ ] `packages/shared-utils/`: create `package.json` and `src/index.ts` with a placeholder utility
- [ ] Each has its own `tsconfig.json` extending the root base
- [ ] Each has a real `name` field matching `@mat/shared-types` etc., so workspace imports resolve

## 3.2 First Real Drizzle Schema (~1.5 hours)

- [ ] Install Drizzle in `services/core-api`
- [ ] Create `db/schema/equipment.ts` with the Equipment table from CODING_STANDARDS.md
- [ ] Create `db/schema/users.ts` (shadow table, references Entra ID `oid` claim)
- [ ] Configure `drizzle.config.ts`
- [ ] Generate first migration: `npm run db:generate`
- [ ] Add `db/seed.ts` with 10 hardcoded equipment records (use the asset tags planned in PRD)
- [ ] Commit: "feat: initial Drizzle schema with equipment and users"

## 3.3 First Real Endpoint (~1 hour)

- [ ] In `services/core-api`, implement `GET /api/v1/equipment` returning the 10 seeded records
- [ ] Add Zod schema in `packages/shared-schemas` for Equipment
- [ ] Wire it up to actually query Postgres via Drizzle
- [ ] Test from local: `curl http://localhost:8080/api/v1/equipment` returns JSON

## 3.4 First PWA Page (~1 hour)

- [ ] In `apps/pwa`, replace "Hello, MAT-Inspect" with a list of equipment
- [ ] Use TanStack Query to fetch from `/api/v1/equipment`
- [ ] Render with shadcn/ui Card components
- [ ] No auth yet; the list is open during dev

## 3.5 First Issue Backlog for Sprint 0 (~30 minutes)

- [ ] Create one issue per task you want teammates to claim in Week 1:
  - "Configure Entra ID app registration with roles" (Backend Engineer 2)
  - "Build login flow in PWA" (Frontend Lead)
  - "Build login flow in dashboard" (Frontend Engineer 2)
  - "Set up Loki + Promtail observability containers" (DevOps/QA/AI)
  - "Design ChecklistTemplate UI mockup" (Frontend Engineer 2)
- [ ] Assign each to the `Sprint 0` milestone
- [ ] Add `good-first-issue` label on the easiest ones
- [ ] Write each issue body with: context, acceptance criteria, links to relevant docs

---

# Final Verification Before Sending Invites

- [ ] Fresh clone test: on a different machine (or in a fresh directory), clone the repo and confirm it runs:

```bash
git clone https://github.com/<org>/mat-inspect.git fresh-test
cd fresh-test
cp .env.example .env
docker compose up
```

- [ ] Open all health endpoints; confirm all green
- [ ] Read your own ONBOARDING.md as if you were a new teammate; fix anything confusing
- [ ] Verify CI on main is green (last commit shows green check)
- [ ] Verify deploy-staging workflow ran successfully (if Tier 2.5 is done)
- [ ] Verify dev staging is reachable over Tailscale from a phone (if you have one on the tailnet)

---

# Inviting Teammates

When everything above is green:

1. **Send each teammate this message** (adapt for your team):

> Hi, ready to start MAT-Inspect.
> Repo: https://github.com/<org>/mat-inspect
> Start with docs/ONBOARDING.md. It is the day-1 checklist.
> I have invited you to: GitHub, Bitwarden (link to follow), Tailscale (link to follow).
> Aim to complete Day 1 of onboarding by [date]. If anything is broken, ping the chat immediately; if it took you longer than 30 minutes to fix, the doc is wrong and we update it.
> First standup: [date and time].

2. **Schedule the first team meeting** (90 min): walk through the architecture, ARCHITECTURE.md, sprint plan, role assignments

3. **Open the Sprint 0 milestone** and have everyone claim their first issue during the meeting

---

# What to Defer to Sprint 0 (Co-Develop With Team)

These do not need to exist before invites:

- Detailed Entra ID app registration and role assignment (coordinate with SAIT IT in Week 1)
- All ADRs beyond ADR-0001 (write them as decisions are made)
- Detailed observability dashboards in Grafana
- E2E test framework setup (Playwright or Cypress)
- Storybook for component library
- Detailed API endpoint implementations beyond the first stub
- AI Service Whisper integration (Sprint 3)
- Audit Service hash chain (Sprint 4)

Doing these solo wastes time the team should spend together; they are also good "first feature" tasks for teammates to own end-to-end.

---

# Estimated Total Time Budget

| Tier                          | Tasks        | Time            |
| ----------------------------- | ------------ | --------------- |
| Tier 1 (must do)              | 8 tasks      | ~12 hours       |
| Tier 2 (strongly recommended) | 6 tasks      | ~9.5 hours      |
| Tier 3 (nice to have)         | 5 tasks      | ~5 hours        |
| **Total**                     | **19 tasks** | **~26.5 hours** |

Realistic schedule: two long weekends (~10 hours each) plus a few weeknights.

If you only have one weekend: complete Tier 1, defer the rest to Week 1 with the team.

---

**End of checklist.**

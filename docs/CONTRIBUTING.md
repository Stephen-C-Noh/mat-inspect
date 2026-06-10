# CONTRIBUTING.md

## MAT-Inspect: Git Workflow and Contribution Guide

---

## Golden Rules

1. **Never push directly to `main`.** Always branch + PR.
2. **Never commit `.env` files or secrets.** Gitleaks blocks them; do not bypass.
3. **Pull before you branch.** Start from the latest `main`.
4. **One feature per branch.** Keep PRs small and reviewable.
5. **PR must be reviewed** by at least one teammate. Security-sensitive areas (auth, audit chain, hash-chain logic) need two reviewers.
6. **Never modify the audit log directly.** All audit events flow through the Audit Service.
7. **AI-assisted code is welcome; AI-unreviewed code is not.** See `docs/AI_USAGE_GUIDE.md`.

---

## Branch Naming

```
type/short-description
```

| Type        | When to use                                 | Example                          |
| ----------- | ------------------------------------------- | -------------------------------- |
| `feature/`  | New functionality                           | `feature/voice-transcription-ui` |
| `fix/`      | Bug fix                                     | `fix/equipment-status-race`      |
| `chore/`    | Config, deps, tooling                       | `chore/upgrade-fastify-5`        |
| `docs/`     | Documentation only                          | `docs/update-api-reference`      |
| `test/`     | Adding or fixing tests                      | `test/inspection-state-machine`  |
| `refactor/` | Code cleanup, no behavior change            | `refactor/extract-audit-client`  |
| `adr/`      | New or updated Architecture Decision Record | `adr/0007-rate-limiting`         |

Use lowercase and hyphens only. Keep it short but descriptive.

---

## Commit Messages

Follow **Conventional Commits**:

```
type: short description in present tense (max 72 chars)
```

| Type         | When to use                             |
| ------------ | --------------------------------------- |
| `feat`       | New feature                             |
| `fix`        | Bug fix                                 |
| `chore`      | Tooling, config, dependencies           |
| `docs`       | Documentation                           |
| `test`       | Tests only                              |
| `refactor`   | Refactor, no behavior change            |
| `style`      | Formatting, whitespace, no logic change |
| `security`   | Security fix or hardening               |
| `compliance` | OHS or FOIP compliance change           |

**Examples:**

```
feat: add voice transcription endpoint to AI service
fix: prevent duplicate inspection on retry after network error
security: enforce role check on report export endpoint
compliance: enforce certification expiry on inspection submit
chore: bump faster-whisper to 1.0.4
docs: clarify defect resolution workflow in FRS
test: add integration test for audit chain verification
refactor: extract equipment state machine into domain layer
```

**Rules:**

- Present tense: `add` not `added`, `fix` not `fixed`
- No period at the end
- Keep under 72 characters in the subject line
- Body (optional) explains _why_ the change is needed
- Commit often: small, focused commits are easier to review and revert

---

## Daily Workflow

```bash
# 1. Start your day: sync main
git checkout main
git pull origin main

# 2. Create your branch
git checkout -b feature/your-task-name

# 3. Make changes, commit often
git add .
git commit -m "feat: add filter dropdown to compliance grid"

# 4. Keep your branch fresh with main (do this daily)
git fetch origin
git rebase origin/main

# 5. Push your branch
git push origin feature/your-task-name

# 6. Open a Pull Request on GitHub
```

---

## Pull Requests

### Before Opening a PR

- [ ] `npm run lint` passes
- [ ] `npm run type-check` passes
- [ ] `npm run test` passes
- [ ] `docker compose up` works locally
- [ ] No `.env` or secrets in the diff
- [ ] Branch is up to date with `main`
- [ ] If you used AI assistance: noted in PR description (see `AI_USAGE_GUIDE.md`)

### PR Title Format

Same as commit messages:

```
feat: add voice transcription endpoint to AI service
fix: prevent duplicate inspection on retry
```

### PR Description Template

```markdown
## What does this PR do?

Brief description of the change.

## Why is it needed?

Link to FRS section, GitHub issue, or sprint goal.

## How to test

Step-by-step verification.

## Screenshots / video (if UI change)

## AI assistance used?

Yes / No. If yes, which sections.

## Compliance impact?

- [ ] Affects audit log structure
- [ ] Affects equipment state machine
- [ ] Affects authentication or authorization
- [ ] Affects PII handling
- [ ] None of the above

## Checklist

- [ ] Tests pass
- [ ] Lint and type-check pass
- [ ] Documentation updated (if user-visible)
- [ ] OpenAPI spec regenerated (if API change)
- [ ] ADR added or updated (if architecture decision)
```

### Review Rules

- **At least 1 approval** required for most PRs
- **At least 2 approvals** required for changes in:
  - `services/audit/` (audit chain, legal record)
  - `services/core-api/src/middleware/auth.ts` (authentication)
  - `services/core-api/src/domain/inspection.ts` (state machine and result computation)
  - `db/migrations/` (schema changes)
- **Author does not merge their own PR.** Reviewer merges.
- Address all review comments before merge (or explicitly discuss and resolve)
- Reviews within **24 hours** of PR being opened during weekdays

### Merge Strategy

**Squash and Merge** on GitHub. One commit per feature on `main`. The squash commit message follows Conventional Commits format.

---

## Resolving Merge Conflicts

```bash
# Update your branch with latest main
git fetch origin
git rebase origin/main

# If conflicts appear, Git pauses. Open the conflicting files,
# resolve the markers (<<<<<<<, =======, >>>>>>>), then:
git add .
git rebase --continue

# Push the rebased branch (force push required after rebase)
git push origin feature/your-branch --force-with-lease
```

Use `--force-with-lease`, never plain `--force`. The lease variant refuses the push if someone else has updated the branch since your last fetch, preventing accidental overwrites.

---

## What Goes in Each Layer

Wrong-layer code is the most common review rejection. Reference:

### Backend Services

| Layer        | Location                       | Responsibility                                               |
| ------------ | ------------------------------ | ------------------------------------------------------------ |
| Routes       | `services/*/src/routes/`       | URL to handler mapping only, no logic                        |
| Handlers     | `services/*/src/handlers/`     | Thin glue: parse input, call use-case, format response       |
| Use-cases    | `services/*/src/use-cases/`    | Business workflow: orchestrate repositories and domain logic |
| Domain       | `services/*/src/domain/`       | Pure logic, no I/O (state machines, computations)            |
| Repositories | `services/*/src/repositories/` | Database access via Drizzle, no business logic               |
| Middleware   | `services/*/src/middleware/`   | Auth, validation, error handling                             |
| Schemas      | `services/*/src/schemas/`      | Zod schemas (often re-exported from packages/shared-schemas) |
| Lib          | `services/*/src/lib/`          | App-specific utilities: logger, errors, audit-client         |
| Config       | `services/*/src/config/`       | Typed environment loading                                    |

### Frontend Apps

| Layer      | Location                 | Responsibility                                                      |
| ---------- | ------------------------ | ------------------------------------------------------------------- |
| App router | `apps/*/src/app/`        | Next.js routes; pages and layouts                                   |
| Components | `apps/*/src/components/` | Reusable UI primitives, no API calls                                |
| Features   | `apps/*/src/features/`   | Feature-specific components and hooks bundled together              |
| Hooks      | `apps/*/src/hooks/`      | Data fetching via TanStack Query; cross-cutting hooks               |
| Store      | `apps/*/src/store/`      | Zustand slices                                                      |
| Lib        | `apps/*/src/lib/`        | API client, utility functions                                       |
| Types      | `apps/*/src/types/`      | App-specific types; cross-app types live in `packages/shared-types` |

### Shared Packages

| Package                    | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `packages/shared-schemas/` | Zod schemas used by both client and server |
| `packages/shared-types/`   | Pure TypeScript types                      |
| `packages/shared-utils/`   | Pure utility functions with no I/O         |

If you find yourself wanting to import code from one service into another, the answer is almost always to put it in a shared package instead. Services do not depend on each other directly; they communicate over HTTP or events.

---

## Code Review Etiquette

### As a Reviewer

- Review within 24 hours during weekdays
- Be specific: link to line numbers
- Distinguish severity:
  - `[blocking]`: must fix before merge
  - `[suggestion]`: optional improvement
  - `[question]`: just asking, not requiring change
  - `[praise]`: noting something well done
- Approve when blocking issues are resolved
- For two-reviewer-required areas, do not approve if you are the only reviewer; tag a second teammate

### As an Author

- Do not take feedback personally; it is about the code, not you
- Respond to every comment: fix it, explain why you did not, or discuss
- Re-request review after addressing comments
- If a review comment leads to a non-trivial change, push a separate commit (do not rewrite history) so the reviewer can see what changed since their review
- After all approvals, the reviewer merges. The author does not click merge on their own PR.

---

## Working With AI Assistants

See `docs/AI_USAGE_GUIDE.md` for the full policy and `CLAUDE.md` for the briefing file to paste into AI sessions.

In short:

- AI assistance is encouraged for boilerplate, scaffolding, tests, debugging help, doc drafts
- AI assistance is restricted for: security-sensitive code, OHS regulatory text, audit service code, architectural decisions
- Always read and understand AI-generated code before committing
- Note significant AI assistance in PR descriptions
- Be able to defend any line at capstone presentation

---

## Protecting Main: Enforced CI Gates

Security on this project is **enforced in tooling**, not left to discipline. The CI pipeline acts as a gate that blocks bad code from reaching `main`.

These rules are configured on GitHub under **Settings → Branches → Branch protection rules** for `main`:

- [x] Require a pull request before merging
- [x] Require at least 1 approval (2 for security-sensitive paths via CODEOWNERS)
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require branches to be up to date before merging
- [x] Restrict who can push to matching branches (no direct push)
- [x] Block force push
- [x] Block deletions
- [x] Require linear history (no merge commits; squash or rebase only)

Required status checks (all must pass before merge):

- `lint` (ESLint, Prettier, Ruff, Hadolint, Markdownlint, zero warnings)
- `type-check` (TypeScript strict, mypy strict)
- `unit-tests`
- `integration-tests`
- `trivy` (fails on HIGH or CRITICAL with available patch)
- `semgrep` (fails on HIGH severity from `p/owasp-top-ten` and `p/security-audit`)
- `gitleaks` (fails on any secret detection in git history)
- `npm-audit` (fails on HIGH or CRITICAL with available patch)
- `build` (Docker images build successfully)

CODEOWNERS forces 2 reviewers on:

- `services/audit/`
- `services/core-api/src/middleware/auth.ts`
- `services/core-api/src/domain/inspection.ts`
- `db/migrations/`

**There is no `--no-verify` escape hatch on `main`.** If CI is failing on your branch, fix the failure. Do not bypass.

---

## Dockerfile Rules

Every Dockerfile in the repo must pass Hadolint and follow these rules. Hadolint runs in CI; failures block merge.

- Pin base image versions explicitly. Never `node:latest`; always `node:22.11-alpine` or similar.
- Use multi-stage builds. Build dependencies live in an intermediate stage; the final image contains only runtime.
- Run as a non-root user: `USER nonroot:nonroot` or a numeric UID/GID (e.g., `USER 1001:1001`).
- Set a `HEALTHCHECK` instruction.
- Use `COPY`, not `ADD`, unless extracting a tarball.
- Do not install build tools (gcc, python-dev, etc.) in the final stage.

Docker Compose adds these constraints in `compose.prod.yml`:

- `read_only: true` on every service; explicit `tmpfs` mounts for what needs to write
- `cap_drop: [ALL]`; `cap_add` only the capabilities each service actually requires (almost always none for Node services)
- `security_opt: [no-new-privileges:true]`
- No `privileged: true` anywhere
- `mem_limit` and `cpus` set on every service
- Networks are explicit; do not rely on the default bridge

---

## Secrets Management

| Environment                      | Where secrets live                                          | How loaded                                                            |
| -------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Local dev                        | `.env` files in repo root                                   | Read by Docker Compose                                                |
| Dev staging (team-owned mini-PC) | `.env` files on the host, mode `0400`, owned by deploy user | Read by Docker Compose; never committed                               |
| Production (Azure path)          | Azure Key Vault                                             | Injected at container startup via Azure SDK or `dapr-secrets` sidecar |
| Production (campus VM path)      | Docker Secrets, file-based                                  | Mounted into containers at `/run/secrets/`                            |
| CI (GitHub Actions)              | GitHub Secrets, scoped per environment                      | Available in workflow as `${{ secrets.NAME }}`                        |

**Never use `.env` files in production.** Audit failures and credential leaks both trace back to "we just used a .env file for convenience." Do not.

---

## CVE Triage SLA

Continuous dependency and vulnerability management:

- **Renovate** (or Dependabot) enabled with weekly grouped PRs. Patch and minor updates auto-merge after CI passes; major updates require human review.
- **HIGH or CRITICAL CVEs with an available patch must be merged within 7 calendar days** of detection by CI. Tracked in a dedicated GitHub Project board.
- **MEDIUM CVEs** are reviewed at the monthly security review; no hard deadline but they do not accumulate indefinitely.
- **No-patch CVEs** are documented with an exception note in `docs/security-exceptions.md`, reviewed quarterly.
- **Monthly security review** (30-minute team meeting): walk through Renovate alerts, Trivy historical reports, audit log integrity verification logs. One team member presents; rotates each month.

---

## Pre-Commit Hooks

A pre-commit hook runs locally before each commit:

- Gitleaks: scans staged changes for secrets
- Prettier: formats staged files
- Ruff: formats and lints Python files
- ESLint: lints staged TS files

Install once after cloning:

```bash
npm run prepare
```

If a commit is blocked because of a Gitleaks finding, **do not bypass** with `--no-verify`. Investigate. Real secrets must be rotated immediately if they were ever committed (even in a branch).

---

## Quick Reference

```bash
# Start new work
git checkout main && git pull
git checkout -b feature/task-name

# Save progress
git add .
git commit -m "feat: description"

# Sync with main (do this daily)
git fetch origin && git rebase origin/main

# Push
git push origin feature/task-name

# After PR is merged: clean up
git checkout main
git pull
git branch -d feature/task-name

# Verify local stack still works
docker compose up
```

---

## What to Do When Things Go Wrong

| Problem                                    | Action                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accidentally committed a secret            | Stop. Tell the team in chat immediately. Rotate the secret. Force-push a fixed history. Do not assume "it's just my branch, it's fine."                        |
| Force-pushed over a teammate's commits     | Stop. Ask the teammate for their local copy of the lost commits. Restore them via git reflog if you can.                                                       |
| CI is red on main                          | Revert the offending commit on a hotfix branch and merge; do not "fix forward" while main is broken                                                            |
| You don't know what to work on             | Ask in standup. Pair on someone else's task. Do not start a new feature without a sprint goal                                                                  |
| You don't understand a code review comment | Ask. Pair-program with the reviewer for 15 minutes. Do not silently ignore it                                                                                  |
| Dev staging is broken                      | Check the GitHub Actions deploy log. If the deploy failed, fix the issue. If the deploy succeeded but the app is broken, roll back via SSH to the staging host |

---

_See `docs/CODING_STANDARDS.md` for code style. See `docs/AI_USAGE_GUIDE.md` for AI policy. See `docs/ARCHITECTURE.md` for system design._

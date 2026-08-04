# Change Management

This document describes how a change moves from proposal to `main` in MAT-Inspect, and what a
future SAIT operational owner needs to know to ship a change safely without the capstone team.
It is written at the control level, the same relationship `SECURITY.md` has to the code.
`docs/CONTRIBUTING.md` carries the full day-to-day git mechanics for a contributor already on
the team; this document is the summary a new owner reads first, plus the parts CONTRIBUTING.md
does not cover: what a change must never break, and what changes when there is no longer a
5-person team to divide review load across.

## 1. Every change starts as a JIRA ticket

Work is tracked in JIRA, project `DEV` (`https://edu-team-asxyfk1n.atlassian.net`), not GitHub
Issues. GitHub Issues on this repository are reserved for automated reports (Renovate, security
scanners). A future owner adopting the system should either keep a JIRA project or replace it
with an equivalent tracker; the important property is one durable ticket per change, referenced
by key in every branch and PR, so the record of _why_ a change happened survives the people who
made it.

## 2. Branch and PR process

**Branch naming.** The convention actually in use is `dev-<ticket-number>-short-kebab-slug`
(for example, `dev-113-audit-ui-prototype`), branched from the latest `main`. `docs/CONTRIBUTING.md`
documents an earlier, type-prefixed convention (`feature/`, `fix/`, `chore/`, and so on); that
table is stale against current practice and should be corrected there, not treated as the
source of truth here. Whichever convention is current, the constant is: one ticket, one branch,
branched from an up-to-date `main`.

**Commits.** Conventional Commits format (`type: short description`), present tense, under 72
characters. See `docs/CONTRIBUTING.md` "Commit Messages" for the full type table.

**Opening the PR.** Title starts with the ticket key: `DEV-12: short description of change`, so
JIRA links the PR automatically. The PR description follows the template in
`docs/CONTRIBUTING.md` ("PR Description Template"): what the change does, why, how to test, and
a compliance-impact checklist (audit log structure, equipment state machine, authentication or
authorization, PII handling, or none of the above). A change that ticks any of the first four
boxes is a change that touches this document's section 5.

**Merge strategy.** Squash and merge. One commit per feature lands on `main`; the squash message
follows Conventional Commits. No merge commits.

## 3. Review requirements

- **1 approval minimum** for most changes.
- **2 approvals** for anything under a path listed in `.github/CODEOWNERS`:
  `services/audit/`, `services/core-api/src/middleware/auth.ts`,
  `services/core-api/src/domain/inspection.ts`, `db/migrations/`. These are the audit chain,
  authentication, the inspection state machine, and schema changes: the four places a defect
  becomes a compliance problem, not just a bug.
- **The author never merges their own PR.** A reviewer merges, after all required approvals are
  in and every required status check is green.
- Review comments get addressed before merge, or explicitly discussed and resolved in the PR
  thread. Silence is not resolution.

These are not a style preference; they are configured as GitHub branch protection rules on
`main` (Settings → Branches): PR required before merging, stale approvals dismissed on new
commits, branch must be up to date before merge, no direct push, no force push, no branch
deletion, linear history only. A future owner migrating off GitHub, or reconfiguring branch
protection, should reproduce this list item for item; each one closes a specific way `main` can
end up with unreviewed or silently-altered code.

## 4. Required CI gates

Every push and PR to `main` runs two workflows, and every job in both is a required status
check. Nothing merges with a red check; there is no `--no-verify` equivalent on `main`.

`.github/workflows/ci.yml`: `lint` (ESLint, Prettier), `type-check` (`tsc`, including the two
Next.js apps separately from the workspace build), `test-ts` (Vitest), `test-python` (pytest,
AI Service), `build` (workspace build), `build-and-push` (every service and app image builds;
on a PR this only builds, it does not push, so a broken image build fails the PR before it fails
`main`).

`.github/workflows/security.yml`: `gitleaks`, `npm-audit`, `semgrep`, `trivy` (filesystem and
Dockerfile config scans), `trivy-image` (per built image), `hadolint`. See
`docs/VULNERABILITY_MANAGEMENT.md` for what each of these actually checks and how findings are
triaged; this document only asserts that they gate merge.

## 5. Compliance invariants a change must not break

These come directly from `CLAUDE.md` section 2 and `SECURITY.md`, restated here because a
change-management document exists precisely to stop a well-intentioned change from crossing
them. A PR that touches any of the following needs the 2-reviewer path in section 3, and should
name the relevant ADR in its description:

- **`inspections`, `inspection_responses`, and `audit_events` are append-only.** Database
  triggers block UPDATE and DELETE on all three. A migration or application change that works
  around this, even for a "one-time data fix," is not a smaller version of a bug fix; it is a
  different, disallowed kind of change. Corrections are new linked records.
- **Only the Audit Service writes `audit_events`.** No other service, script, or manual query
  writes to that table, including for hotfixes or backfills.
- **Every inspection record identifies the operator.** Operator id from the validated token,
  an explicit attestation, and a server timestamp are required on submit (ADR 0007). No change
  introduces an anonymous or auto-attested submission path, including in test fixtures that
  could leak into a shared code path.
- **Equipment cannot reach READY without a same-day passing Inspection performed after the
  most recent return-to-service** (ADR 0006). No change adds a "skip the check" or "force
  READY" code path, including for testing or demos; use the seed script and proper fixtures
  instead.
- **The AI Service is assistive only.** No change lets transcription or the Advisory Check
  auto-pass or auto-fail an inspection (Alberta OHS s.257 requires the human operator to
  complete the visual inspection).
- **Voice clips stay on infrastructure the operator's organization controls.** No change routes
  audio to an external AI API.

A reviewer who sees a PR cross one of these lines should block it regardless of how urgent the
underlying task is. There is no emergency that justifies removing the append-only guarantee on
the legal record.

## 6. How a future owner ships a change, end to end

1. Confirm or file a JIRA ticket (`DEV-*`) describing the change and why.
2. Branch from an up-to-date `main`: `git checkout main && git pull && git checkout -b dev-<ticket>-<slug>`.
3. Make the change. If it touches section 5, say so in the PR description up front.
4. Open a PR titled `DEV-<ticket>: <description>`, filled out from the PR template.
5. Get the required approvals: 1, or 2 if a CODEOWNERS path is touched.
6. Wait for every required status check in section 4 to pass. Fix failures; do not bypass them.
7. A reviewer (not the author) merges via squash.
8. Deploy the merged image. `build-and-push` on `main` publishes
   `ghcr.io/<owner>/mat-inspect/<service>:latest` and `:sha-<commit>`. The team demo and mini-PC
   stack pull the new image per `docker-compose.yml`; a SAIT-hosted deployment follows
   `docs/runbooks/azure-deployment-and-entra-setup.md`, which is an environment change (tenant
   IDs, connection strings, app registration), not an application code change (ADR 0016,
   `SECURITY.md` section 15).
9. If the deploy misbehaves, roll back to the previous `:sha-<commit>` image tag rather than
   attempting a fix forward under pressure; `docs/CONTRIBUTING.md` ("What to Do When Things Go
   Wrong") states the same principle for a red `main`: revert on a hotfix branch through the
   normal PR process, do not patch around CI.

## 7. Emergency changes

There is no separate emergency or hotfix path that skips review or CI. A production incident is
handled by reverting the offending change on a new branch, through the same PR process in
section 6, not by pushing directly to `main` or disabling a gate. Branch protection enforces
this technically (section 3): no one, including an admin, can push directly to `main` under the
current GitHub settings. A future owner who needs a genuinely faster incident path should build
it as a documented, audited exception (for example, a break-glass role with logged usage), not
as a standing bypass of the gates in section 4.

## 8. Responsibility after handover

During the capstone, the 5-person team fills every role in this document: author, reviewer,
CODEOWNERS approver, and merge approver. That does not scale to a solo maintainer and cannot be
copied as-is. A future SAIT operational owner (named in the governance adoption brief, DEV-79)
should, before taking on live changes:

- Name at least two people who can review CODEOWNERS-gated paths, so the 2-reviewer rule in
  section 3 is enforceable rather than aspirational.
- Decide whether GitHub branch protection and Actions stay as the enforcement mechanism, or
  whether they move to SAIT's existing CI/CD and code-review tooling. If they move, reproduce
  the rule list in section 3 and the gate list in section 4 in the new tooling before removing
  the old one, not after.
- Keep the compliance invariants in section 5 as non-negotiable regardless of which tooling
  enforces them. They come from Alberta OHS and FOIP obligations, not from GitHub configuration.

## 9. References

ADR 0006 (computed equipment readiness), ADR 0007 (attestation over HMAC), ADR 0008 (audit
chain), ADR 0016 (governance package, no SAIT-hosted production during the capstone),
`CLAUDE.md` section 2 (critical compliance constraints) and section 13 (issue tracking),
`SECURITY.md`, `docs/VULNERABILITY_MANAGEMENT.md`, `docs/CONTRIBUTING.md`, `.github/CODEOWNERS`,
`docs/runbooks/azure-deployment-and-entra-setup.md`, `docs/runbooks/backup-and-restore.md`.

# PRD-2: MAT-Inspect Pre-Use Inspection System

**Version:** 2.0 | **Date:** June 9, 2026
**Status:** Reference. Restructured companion to `docs/PRD.md` (v1.0).
**Relationship to v1:** Same product, same scope. This version reorganizes the
requirements around the to-prd template (problem, solution, user stories,
implementation decisions, testing decisions) and folds in the decisions recorded
in ADR 0006 through ADR 0012. Where the two disagree, the ADRs and this document
win, because they postdate v1.

---

## Problem Statement

SAIT's MAT School runs high-risk equipment (4 overhead cranes, 2 trucks, 1
electric pallet jack, 3 forklifts) that Alberta OHS requires an operator to
inspect before each use. Today the inspection is a paper sheet on a clipboard.

From the people who live with it:

- A Lab Tech starting a shift cannot tell whether the last operator's inspection
  still counts for today, and the clipboard sheet is often missing. Completion
  sits near 60 percent.
- A Supervisor learns that equipment failed inspection hours later, by word of
  mouth. There is no record of who reported what, when.
- An Operations Manager cannot show, at any given moment, that the school meets
  OHS requirements. An audit triggers a multi-day paper search.
- An external OHS Inspector finds paper records that are incomplete, unsigned, or
  contradictory across copies, and cannot confirm they are authentic.
- A SAIT IT Admin will inherit whatever the capstone team leaves behind, and
  capstone handovers are usually undocumented and fragile.

The shared problem: the inspection record is paper, so it is skippable, slow to
retrieve, easy to lose, and impossible to prove untampered.

---

## Solution

A digital pre-use inspection system that keeps the human operator in charge and
makes the record provable.

From each user's view:

- A Lab Tech scans the equipment QR sticker, completes a checklist on a phone,
  dictates defect notes by voice, reviews a summary, and confirms. The confirm is
  the operator attestation. Result and equipment status follow from the answers,
  not from anything the phone claims.
- A Supervisor gets an email and a Microsoft Teams message the moment equipment
  fails inspection, sees an unresolved-failure queue on the dashboard, and runs the
  defect through acknowledge, repair, and an explicit return-to-service approval.
- A Manager sees a daily compliance grid, drills into any machine's history, and
  exports a filtered report.
- An Auditor gets a read-only, time-boxed account and a signed PDF whose audit
  chain segment can be verified independently.
- An Admin runs the system from Docker with a runbook, Azure Monitor alerts, and
  backup automation.

The system never auto-passes or auto-fails an inspection. AI transcribes voice
and may suggest a defect category; a competent human always decides (OHS s.257).

Equipment readiness is computed, not scheduled. There is no shift abstraction and
no nightly reset job (ADR 0006). Tamper-evidence comes from an append-only,
hash-chained audit log fed by a transactional outbox, plus a content digest over
the inspection answers (ADR 0007, ADR 0008). There is no per-record HMAC.

---

## User Stories

### Authentication and access

1. As a Lab Tech, I want to sign in once at shift start with my SAIT account and
   stay signed in for the shift, so that I do not re-enter credentials between
   machines.
2. As a Supervisor, I want MFA on my account, so that a stolen password alone does
   not reach compliance records.
3. As an Admin, I want to deactivate a departing user instantly, so that they lose
   access the moment they leave SAIT.
4. As an Auditor, I want my account to expire at the end of my engagement, so that
   my access does not persist past the audit.
5. As any user, I want an endpoint I am not authorized for to refuse me, so that
   the system fails closed rather than leaking data.
6. As a developer, I want auth to fall back to a dev token only when Entra config
   is absent in local dev, so that I can run the stack without a tenant and
   production stays strict.

### Equipment and QR scan

7. As a Lab Tech, I want to scan the equipment QR sticker and immediately see that
   machine's checklist, so that I start the right inspection without searching.
8. As a Lab Tech, I want the equipment page to show current status (READY,
   AWAITING_INSPECTION, OUT_OF_SERVICE, RETIRED), so that I know its state before
   I operate it.
9. As an Admin, I want to register equipment with a unique asset tag
   (MAT-{TYPE_CODE}-{NNN}) and print its QR code, so that every machine is
   addressable.
10. As a Manager, I want a list of all equipment with last-inspection details, so
    that I can see the fleet at a glance.

### Inspection submission

11. As a Lab Tech, I want each checklist item to show whether a failure is
    blocking or a warning, so that I know if the equipment is usable.
12. As a Lab Tech, I want required items marked and the submit button disabled
    until all are answered, so that I cannot submit an incomplete inspection.
13. As a Lab Tech, I want to dictate defect notes by voice with gloves on, so that
    I do not remove my gloves to type.
14. As a Lab Tech, I want a captured transcript shown to me to edit before submit,
    so that I confirm what the AI heard (notes_source records TYPED,
    VOICE_TRANSCRIBED, or VOICE_EDITED).
15. As a Lab Tech, I want to take a photo for any failed item, so that the
    Supervisor sees the issue (photo required on a failed BOOLEAN_PHOTO_ON_FAIL
    item).
16. As a Lab Tech, I want a review summary ("12 items, 1 failed, submitting as
    Jane Doe") and one confirm action, so that I attest deliberately before commit.
17. As a Lab Tech, I want a clear green PASS or red FAIL after submit, so that I
    know whether to operate the equipment.
18. As a Lab Tech, I want the server to decide the result from my answers and the
    template, so that no one can submit a forced result.
19. As a Lab Tech off-network, I want my submission queued and sent when
    connectivity returns, so that a dead zone does not lose my inspection.
20. As a Lab Tech, I want a retried submission to not create a duplicate, so that a
    flaky network does not double-record an inspection (Idempotency-Key, ADR 0009).
21. As a Lab Tech expired on an equipment class, I want a clear reason for the
    rejection, so that I understand why I cannot submit instead of seeing a vague
    error.

### Equipment readiness and state machine

22. As a Lab Tech, I want equipment to count as READY only with a passing
    inspection from today that postdates the last return-to-service, so that a
    stale or pre-repair pass never makes it usable (ADR 0006).
23. As a Supervisor, I want any blocking failure to move equipment to
    OUT_OF_SERVICE automatically and open a Defect, so that unsafe equipment is
    locked out without a manual step.
24. As a Lab Tech, I want a digital lockout tag with the equipment ID shown after a
    blocking failure, so that there is a clear on-screen record of the lockout.
25. As a Supervisor, I want return-to-service to require a resolved Defect, my
    approval, and a fresh passing inspection, so that equipment is never restored
    on partial grounds.

### Defect workflow

26. As a Supervisor, I want an email and a Microsoft Teams message the moment
    equipment fails, so that I react in minutes, not hours (ADR 0013).
27. As a Supervisor, I want a persistent unresolved-failure queue on the dashboard,
    so that a missed notification does not mean a missed defect.
28. As a Supervisor, I want to acknowledge a Defect, assign it, and track it
    through OPEN, ACKNOWLEDGED, IN_REPAIR, and RESOLVED or REJECTED, so that repair
    progress is visible.
29. As a Supervisor, I want only Supervisor or Manager to resolve a Defect, so that
    resolution carries authority.
30. As a Lab Tech who reported a defect, I want notice when it is acknowledged and
    when it is resolved, so that I know the report was acted on.

### Manager visibility

31. As a Manager, I want a daily compliance grid of every machine, its last
    inspection, who did it, and the result, so that I see compliance live.
32. As a Manager, I want to drill into a machine's full history with photos and
    voice transcripts, so that I can investigate an issue end to end.
33. As a Manager, I want to filter inspections by date range, equipment type,
    location, and operator, so that I can find patterns.

### Audit and reporting

34. As an Auditor, I want a signed PDF for any machine over any date range that
    includes responses, photos, attestations, and the audit chain segment, so that
    I have a complete, verifiable record.
35. As an Auditor, I want to verify the audit chain hash independently, so that I
    can confirm records were not tampered with.
36. As an Auditor, I want a post-hoc edit to any inspection answer to be
    detectable, so that the legal record is provable, not just hard to change
    (content digest, ADR 0008).
37. As a Manager, I want CSV export, so that I can analyze data in a spreadsheet.
38. As an Admin, I want all access to audit records to itself be audited, so that I
    can investigate suspicious activity.

### Operator self-service

39. As a Lab Tech, I want my own inspection history, so that I can refresh on
    equipment I have not used recently.
40. As a Lab Tech, I want a warning at 30, 14, and 7 days before a certification
    expires, so that I renew on time.

### Operations and handover

41. As an Admin, I want Azure Monitor metrics, logs, and availability checks with
    alerts, so that I notice problems before users report them (ADR 0003).
42. As an Admin, I want an alert when outbox delivery lag grows, so that a stalled
    audit poller is caught quickly (ADR 0008).
43. As an Admin, I want an alert on audit chain verification failure and on backup
    failure, so that integrity and recovery problems page me immediately.
44. As an Admin, I want a runbook and Docker-based deployment, so that I can
    operate and recover the system without the original team.

---

## Implementation Decisions

### Services and boundaries

- Four backend services plus two frontends, in an npm-workspaces monorepo
  (ADR 0001): `core-api` (Fastify, business logic and the state machine), `media`
  (Fastify, Azure Blob uploads, ADR 0004), `audit` (Fastify, hash chain and PDF
  reports), `ai` (FastAPI, faster-whisper small.en). Frontends: `apps/pwa`
  (operator) and `apps/dashboard` (manager).
- Services do not import across each other's directories. Shared types live in
  `packages/shared-types`, shared Zod schemas in `packages/shared-schemas`.
- Caddy terminates TLS and reverse-proxies. No message broker is in the stack;
  inter-service audit delivery is the outbox poller over HTTP (ADR 0008).

### Auth

- Entra ID, validated centrally through `verifyToken`; no per-endpoint JWT
  parsing. Every endpoint declares required roles via a `preHandler`; undeclared
  endpoints return 403.
- API authorization is by access-token scope, not a separate API key
  (ADR 0012). Roles are explicit permission sets in
  `packages/shared-types/roles.ts` and the policy matrix in
  `core-api/src/auth/policy.ts`. Roles are not hierarchical; a user may hold
  several.
- Local dev: auth uses the real Entra tenant. `ENTRA_TENANT_ID` and
  `ENTRA_CLIENT_ID` are required at boot (ADR 0015), and the PWA acquires a real
  access token through MSAL. The dev-only `/dev/token` fallback was removed once
  real auth was proven (DEV-61, ADR 0021); automated tests inject a local key set
  with `setJwksForTest` instead.

### Inspection submit (the core write)

- Identity comes from the validated token `oid`, never from the body. The body
  carries answers and `attested: true`; the server derives the result from the
  responses and the template `fail_severity` (ADR 0007). A client-sent result is
  never trusted.
- The submit is one core_db transaction that inserts the Inspection, its
  responses, and an `outbox` row atomically (ADR 0008). A poller (interval loop)
  delivers outbox rows to the Audit Service; delivery is at-least-once and the
  chain deduplicates by event id.
- Write endpoints accept an `Idempotency-Key`; a key store dedupes retries
  (ADR 0009) so an offline-queue resend does not double-record.
- Inspections and inspection_responses are immutable. UPDATE and DELETE blocking
  triggers enforce it, matching `audit_events`. Corrections are new linked
  inspections, never edits.

### Equipment readiness (computed, ADR 0006)

- No shift entity, no `shift_window_id`, no scheduled reset job. Readiness is
  computed at read time. Equipment is READY iff: a passing inspection exists with
  `submitted_at` on the current lab-local (America/Edmonton) calendar day; that
  `submitted_at` is at or after the equipment's `readiness_baseline_at` watermark;
  status is not OUT_OF_SERVICE or RETIRED; and there is no open blocking Defect.
- OUT_OF_SERVICE and RETIRED are stored, sticky states that override the computed
  result. AWAITING_INSPECTION is never written; it is what equipment reads as when
  no passing inspection satisfies the conditions.
- Return-to-service sets `readiness_baseline_at = now()`, so a same-day pre-repair
  pass no longer restores READY and a fresh inspection is required.

### Audit integrity (ADR 0007, ADR 0008)

- No per-record HMAC. Tamper-evidence is the append-only, hash-chained audit log
  (each event stores `prev_hash` and `this_hash`, SHA-256). The audit_db role has
  INSERT only; UPDATE and DELETE are revoked.
- The `INSPECTION_SUBMITTED` event carries
  `content_hash = sha256(canonical_json(inspection + ordered responses + result))`
  using RFC 8785 canonicalization. A hash is not PII. Verification recomputes the
  digest from core_db and compares it to the sealed value; a later edit diverges.
- The Audit Service verifies chain integrity on startup and on export. Export PDFs
  embed the relevant chain segment for independent verification.

### Defects and notifications (ADR 0010, ADR 0011)

- Each blocking failure creates exactly one Defect. Status flow: OPEN,
  ACKNOWLEDGED, IN_REPAIR, RESOLVED or REJECTED. Only Supervisor or Manager
  resolves. Return-to-service approval is a separate explicit action, not implied
  by resolution.
- Failed-inspection alerts go to all active Supervisors over three channels:
  email (SMTP), Microsoft Teams, and a persistent dashboard unresolved-failure
  queue. The dashboard queue is the source of truth; email and Teams are
  best-effort notifications (ADR 0013, superseding ADR 0010).
- Inspection records do not store a device fingerprint (ADR 0011); identity and
  attestation carry the compliance weight.

### Data, validation, and storage

- All data access through Drizzle. Schema in `db/schema/*.ts`, one table per file
  (`equipment.ts` and `users.ts` exist; `inspections`, `inspection_responses`,
  `defects`, `audit_events`, `outbox`, and the idempotency store are still to be
  added). Migrations via `drizzle-kit generate`; generated SQL is read before
  commit and not hand-edited.
- Every endpoint validates input with Zod. Schemas are shared between client and
  server through `packages/shared-schemas`. OpenAPI is generated from them.
- Photos, voice clips, and PDFs go to Azure Blob (Azurite in dev), via the Media
  Service (ADR 0004). Voice audio is biometric PII under FOIP; it stays on
  SAIT-controlled infrastructure and is never sent to an external AI API. Audio is
  retained 90 days; transcripts and the rest of the record are retained 7 years.
- Checklist items are BOOLEAN or BOOLEAN_PHOTO_ON_FAIL only. An abnormal reading
  goes in free-text item notes (max 500 chars), not as structured numeric data.

### Errors and logging

- Errors follow RFC 7807 via the `httpError(status, code, detail)` helper; route
  handlers do not throw plain `Error`.
- Structured JSON logging through Pino. Never log tokens, transcript text, raw PII
  bodies, or identifying photo URLs. Always log request id, user id (uuid),
  equipment id, action, and timing. Audit events are written by the Audit Service,
  not duplicated in application logs.

---

## Testing Decisions

### What makes a good test here

Test external behavior at the highest seam, not implementation detail. The seam
that matters most is the inspection submit and the readiness query, because a bug
there is a compliance failure, not just a defect. Integration tests use real
Postgres and Azurite in containers (testcontainers). Internal modules are not
mocked; only external services (SMTP) are mocked.

### Modules and the behaviors to cover

- **Equipment state machine and readiness query (core-api).** Highest priority.
  Cover every transition and the ADR 0006 conditions: a same-day pass yields
  READY; a pass from yesterday does not; a pass that predates
  `readiness_baseline_at` does not; OUT_OF_SERVICE and RETIRED override a valid
  pass; an open blocking Defect blocks READY. Prove equipment cannot reach READY
  without a valid attested inspection.
- **Inspection submit (core-api).** The server derives the result from responses
  and template severity; a client-sent result is ignored. Identity comes from the
  token, not the body. Inspection, responses, and the outbox row commit in one
  transaction or none do. The immutability triggers reject UPDATE and DELETE.
- **Idempotency (core-api).** Concurrent and retried submissions with the same key
  produce one inspection, not duplicates (ADR 0009). This is the data-loss /
  double-write race called out in the test plan.
- **Audit chain (audit).** A dedicated integrity test over a large run of events
  (the test plan uses 10,000 simulated events). The chain verifies on clean
  startup. A tampered response makes the recomputed content digest diverge from
  the sealed value (ADR 0008). A PDF export embeds a verifiable chain segment.
- **Auth boundaries (core-api).** Role-boundary tests per endpoint: an undeclared
  or unauthorized role gets 403. Negative tests on certification expiry: an
  expired operator is rejected with a clear reason.
- **AI isolation (ai).** A network-isolation test proves voice audio never leaves
  SAIT infrastructure. AI Service failure falls back to typed notes and does not
  block submission.

### Prior art and tooling

Vitest for TypeScript, pytest for Python; test files `*.test.ts` alongside source.
Coverage target 70 percent on business logic, not chased on glue code. The
existing equipment-list work (DEV-7) and the equipment endpoint are the nearest
landed prior art for route-plus-Drizzle integration tests. Test execution and the
59-case matrix are tracked in `docs/TEST_PLAN.md`; completion requires a 95
percent pass rate, all BLOCKING defects resolved, and no HIGH or CRITICAL
findings from Trivy, Semgrep, or Gitleaks.

---

## Out of Scope

For the 13-week capstone (final deliverable August 15, 2026):

- Multi-campus support (Aero Centre, Pt. Trotter). MVP is Main Campus, 10 machines.
- Native iOS and Android apps. The PWA is the only client.
- Per-operator cryptographic signatures. Key provisioning on individually assigned
  operator devices is out of scope; attestation plus the audit chain is the accepted
  model (ADR 0007).
- A message broker. The outbox poller covers delivery (ADR 0008).
- Closed-loop alert delivery (Teams acknowledgement, SMS escalation). Alerts are
  best-effort over email and Teams, with the dashboard queue as the durable source
  of truth (ADR 0013 appendix).
- mTLS between internal services, and Entra federation for SAIT SSO (configurable
  now, deferred).
- AI value-adds: photo defect classification, trend visualization, anomaly
  detection, predictive maintenance, LLM defect summaries. These are P2 or P3.
- French localization. English only at MVP; the architecture leaves room via
  i18next and message keys.
- Structured numeric checklist readings. Items are boolean; abnormal values go in
  free-text notes.

---

## Further Notes

- This document does not restate the full non-functional requirements, equipment
  and checklist tables, notification matrix, sprint timeline, risk register, or
  success metrics. Those remain in `docs/PRD.md` v1.0 and are still current.
  Section 6 (Key Business Rules) and Section 2 (compliance constraints) of v1
  should be read with ADR 0006, 0007, and 0008 layered on top.
- Source-of-truth chain: `docs/ARCHITECTURE.md` (the Capstone Plan) for structure,
  `docs/adr/` for decisions, `docs/FRS.md` for acceptance criteria,
  `docs/API_REFERENCE.md` for contracts, `docs/TEST_PLAN.md` for the test matrix.
- Open items not yet decided in an ADR: the daily not-inspected cutoff time
  (notification matrix lists it as TBD), and the final checklist content per
  equipment class (locked by end of Week 4 per the risk register).
- Compliance guardrails that constrain every story above: OHS s.257 keeps a human
  operator in the loop (AI never auto-passes or auto-fails); OHS Part 6 requires
  every inspection to identify the operator; the inspections, inspection_responses,
  and audit_events tables are append-only; voice clips stay on SAIT infrastructure
  under FOIP.

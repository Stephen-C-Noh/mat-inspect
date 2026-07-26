# Security

This document describes the security controls of the delivered MAT-Inspect system. It is written
for a future SAIT security reviewer evaluating the system for adoption. It documents the system as
built, not the original plan. Where the code and an older design document disagree, this document
follows the code and says so.

MAT-Inspect is a capstone project. During the capstone the system runs on team-owned
infrastructure and a team-owned Azure tenant (ADR 0016, ADR 0024). Statements below about a
SAIT-hosted deployment describe what adoption would require, not the current state. `SAIT_IT_BRIEF.md`
is the executive infrastructure summary; this document is the control-level reference behind it.

## Reporting a vulnerability

Do not open a public GitHub issue for a security problem. GitHub Issues on this repository are for
automated reports only (see CLAUDE.md section 13). Report suspected vulnerabilities privately to the
project maintainers (the capstone team, and post-handover the SAIT business owner named in the
governance adoption brief, DEV-79). A GitHub private security advisory on this repository is the
preferred channel. Include the affected component, reproduction steps, and impact.

## 1. Authentication

Azure Entra ID is the sole identity provider (ADR 0002). There is no local user store and no
password handling in the application. All users are SAIT staff with existing accounts; during the
capstone the tenant is a team-owned personal tenant, and the swap to a SAIT tenant is an environment
change only (`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`), no code change.

Token validation is one implementation, shared by every service. `createEntraAuth` in
`packages/shared-auth-server/src/entra-auth.ts` builds the `verifyToken` preHandler. No service
performs per-endpoint JWT parsing. `verifyToken`:

- Requires a `Bearer` token in the `Authorization` header.
- Verifies the signature against the Entra ID JWKS endpoint
  (`https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`) using `jose`.
- Enforces `iss` (`https://login.microsoftonline.com/{tenant}/v2.0`) and `aud` (`ENTRA_CLIENT_ID`)
  when the tenant is configured.
- Derives the user identity from the `oid` claim (the stable Entra object ID), never from the
  request body.

Authorization uses an **access token** scoped to a custom API scope `api://{clientId}/access_as_user`,
not an ID token (ADR 0012). Because the SPA and the API share one app registration, the access
token's `aud` equals the client id and the audience check passes. ID tokens are used only for the
client's own session, never as the API bearer.

Token policy (Entra ID defaults, managed at the tenant level): short-lived access tokens, refresh
tokens rotated on use, MFA and Smart Lockout and conditional access enforced by Entra ID, not by the
application.

For local development and CI only, core-api exposes `/dev/token` and `/dev/jwks`, registered when
`NODE_ENV !== 'production'`. They mint and verify a local dev JWT so tests run without a live tenant.
They are never registered in production.

## 2. Authorization

Authorization is declared per route through the `requireRole(...)` preHandler
(`packages/shared-auth-server`), applied in each service's route registration. There is no central
policy file; an earlier design named a Casbin or JSON policy layer (ARCHITECTURE.md section 8.2) that
was never built. ARCHITECTURE.md section 8.2 is stale on this point; the per-route `requireRole`
model plus the boot guard below is the shipped design.

**Fail-closed at boot (ADR 0014).** Each service registers an `onRoute` guard
(`services/*/src/middleware/auth-route-guard.ts`). For every route, the guard checks for a preHandler
tagged with the `Symbol.for('mat-inspect.authPreHandler')` marker that `verifyToken` and
`requireRole(...)` carry. If a route has no tagged authenticator and its URL is not in the explicit
public allowlist, the service crashes at boot. A misgated route never starts serving; the defect
cannot reach a running deployment. The public allowlist is `['/health', '/dev/jwks', '/dev/token']`
(`PUBLIC_ROUTES` in each service). Adding a public route is a deliberate, visible act.

**Roles.** Five App Roles, defined on the Entra app registration, lowercase to match the `UserRole`
union in `packages/shared-types/src/index.ts`: `operator`, `supervisor`, `manager`, `admin`,
`auditor`. Roles are **not hierarchical**. `auditor` is read-only and time-boxed (ADR 0021) and is
never inherited by or treated as equivalent to `manager` or `admin`. `operator` encodes Alberta OHS
s.257 operator competency and is never inherited by any other role. `requireRole` compares the claim
case-sensitively, so a mis-cased App Role value fails closed with 403.

**Service-to-service calls** use separate bearer tokens, not Entra tokens: `AUDIT_INGEST_TOKEN`
guards the Audit Service ingest endpoint (`services/audit/src/middleware/ingest-auth.ts`), and
`CORE_API_INTERNAL_TOKEN` guards core-api's internal reports-data endpoint
(`services/core-api/src/middleware/internal-auth.ts`). These endpoints are reachable only on the
internal Docker network, never through the gateway.

## 3. Operator identity and attestation

Alberta OHS Part 6 requires every inspection record to identify the person doing the work. This is
satisfied by authenticated identity plus recorded intent, not by a per-record cryptographic
signature (ADR 0007). Each Inspection carries:

- The operator's authenticated identity, taken from the validated token `oid` claim (not the body).
- An explicit operator attestation: the client sends `attested: true` only after the operator
  reviews a summary of their answers and confirms. This is both the legal attestation and a safety
  check before commit.
- A server-recorded timestamp.

The submit route derives the pass/fail result from the responses and the template fail severity on
the server; it never trusts a client-sent result (`services/core-api/src/routes/inspections/submit.ts`,
CLAUDE.md section 6).

Accepted residual risk: attestation trusts the server. An actor with direct database write access
could in principle fabricate an Inspection under an operator's identity. A per-operator cryptographic
signature would defend this, but per-user key provisioning on shared lab tablets is out of scope for
the capstone. This limitation is stated, not hidden (ADR 0007).

## 4. Data integrity: immutability and the audit chain

**Immutable records.** `inspections`, `inspection_responses`, and `audit_events` are append-only.
UPDATE and DELETE are blocked by database triggers
(`db/migrations/0004_inspection_immutability_triggers.sql` for the inspection tables). Corrections are
new linked records, never edits. If you see application code that attempts UPDATE or DELETE on these
tables, it is a defect.

**Hash-chained audit log (ADR 0008, ARCHITECTURE.md section 8.4).** The audit log is the legal
record. Only the Audit Service writes it; the runtime connection uses the `audit_writer` role
(INSERT only on `audit_events`), and schema changes use a separate `audit_migrator` role (DDL, no
INSERT). Each event seals the SHA-256 hash of the previous event. Hash inputs are serialized with RFC
8785 canonical JSON over a fixed field set with normalized UTC timestamps, so the same logical record
always produces the same bytes. Chain extension serializes on a Postgres advisory lock, so concurrent
writers queue instead of forking the chain. The Audit Service verifies the chain on startup and runs a
nightly full-chain verification; a break raises a CRITICAL alert.

**Content digest.** For `INSPECTION_SUBMITTED`, the audit event seals
`content_hash = sha256(canonical_json(inspection + ordered responses + result))`. To verify later,
recompute the digest from the database row and compare it to the value in the chain. A post-hoc edit
to any response makes the digests diverge, which detects tampering even though the responses live
outside the chain. A hash is not PII, so this does not violate the no-PII rule for the audit log.

**Delivery.** An inspection and its intent-to-audit commit atomically through a transactional outbox
(same transaction as the Inspection rows), and a poller delivers to the Audit Service. Delivery is
at-least-once; the chain deduplicates by event id. Audit Service downtime does not block operators
and does not lose events.

Documented gap (ADR 0008, ARCHITECTURE.md section 8.4 rule 6): a PL/pgSQL reimplementation of the RFC
8785 canonicalizer for a database-level CHECK constraint is deferred, because a canonicalizer that
diverges from the Node library would be worse than none. Startup and nightly verification in Node,
where the real canonicalizer runs, cover the same "detect an application bug" goal. This is a stated
gap, not a hidden one.

## 5. Report export signatures

Exported PDF and CSV audit reports carry a detached signature, not an embedded PAdES signature
(ADR 0022). The Audit Service signs `sha256(file bytes)` with an RSA private key
(`REPORT_SIGNING_PRIVATE_KEY`, PEM, via Node's built-in `crypto`). The signature and a public-key
fingerprint are returned by `GET /api/v1/reports/:jobId` alongside the file hash, and the last page of
the PDF points at that endpoint. Verification is: fetch the file, recompute the SHA-256, verify the
signature against the recorded public key. This proves the Audit Service produced those exact bytes.
It does not render the "Signed and all signatures are valid" panel a PDF viewer shows for a
certificate-backed signature; obtaining a trusted certificate is a compatible post-handover upgrade.

## 6. Input validation and injection prevention

- Every API endpoint validates input with Zod. Shared schemas live in `packages/shared-schemas`;
  route-specific schemas live next to the route.
- All database access goes through Drizzle ORM with parameterized queries. There is no raw SQL string
  construction and no string concatenation of user input into SQL.
- Untyped input is typed as `unknown` and narrowed with Zod, not cast to `any`.

## 7. Secrets management

Secrets are never committed. They live in `.env` on the host (dev and the team demo) and, for a SAIT
production deployment, in Docker Secrets or Azure Key Vault (ADR 0016; Key Vault was evaluated and
deferred for the capstone). `.env.example` and `.env.azure.example` ship only obvious placeholders
(`REPLACE_ME`).

**Boot-time environment validation (ADR 0015).** core-api validates the whole environment once at
boot with a Zod schema plus semantic checks (`services/core-api/src/lib/config.ts`), before any app
module loads. A placeholder value (`REPLACE_ME`, `xxxx`, `changeme`) for any secret aborts the boot
with the variable named. `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and
`APPLICATIONINSIGHTS_CONNECTION_STRING` are required in development and production. `NODE_ENV=test` is
the only exemption from the required-value checks. The media and audit services carry an inline
version of the same fail-fast check.

**Secret scanning.** Gitleaks scans the full git history on every CI run (`.github/workflows/security.yml`).

## 8. Transport and network security

Caddy is the single front door (ADR 0020). The `/api/v1` routing table lives in one Caddy snippet, so
no origin can disagree about where a path goes.

- TLS terminates at Caddy: an internal CA for the campus-only or demo deployment (`tls internal`),
  ACME (Let's Encrypt) for a public hostname.
- The operator PWA and the manager dashboard are served on two separate origins. This isolates their
  MSAL token caches so an operator session and a manager session never share a storage boundary
  (ADR 0020).
- The browser reaches the apps only through Caddy over TLS. The app and service containers publish no
  host ports; only Caddy publishes 80 and 443 (and a loopback-only 8080 dev listener). Internal
  service traffic stays on the private `mat-internal` Docker network.
- The AI Service has no gateway route and no authentication of its own. It is reached only through
  core-api, which authenticates the operator and proxies the clip on the internal network (ADR 0019).
  The audio it receives is biometric PII, so it is never exposed to the browser.

## 9. AI-specific security

- The transcription model (faster-whisper) and the Advisory Check model (an on-prem SLM) run in our
  own containers. Audio and note text never leave infrastructure the operator controls, and no data
  is sent to any external AI API (ADR 0016, ADR 0018, CLAUDE.md). This holds whether the container
  runs on the mini-PC or on the team Azure VM, because running our own model on our own compute is not
  use of a managed AI service.
- Voice clips are biometric PII under FOIP. The biometric identifier is the voice signal itself, not
  only the spoken content, so the audio is never sent to a public transcription service even if the
  transcript were redacted.
- The transcript is stored as plain text and is never fed to an LLM in this version. If a future
  feature feeds transcripts to an LLM, treat them as untrusted input (prompt-injection surface).
- Transcription accuracy is not perfect. The operator confirms the transcript before submission, and
  the schema records `notes_source` (typed, voice-transcribed, or voice-edited). Transcripts are
  notes only; they never drive the pass/fail decision, which comes from the structured checklist.
- An AI Service failure never blocks an inspection: the PWA falls back to typed notes.

## 10. Logging and privacy

Structured JSON logging only (Pino); no `console.log` in service code. Logs never carry passwords,
tokens, JWT contents, raw request bodies with PII, voice transcript text, or photo URLs with user
identifiers. Logs do carry request IDs, user IDs (UUID only, not names), equipment IDs, action names,
and timing. Audit events are written only by the Audit Service to the audit database; they are not
duplicated in application logs.

FOIP summary (full inventory in ARCHITECTURE.md section 8.7 and `SAIT_IT_BRIEF.md`): PII is operator
name and email (stored as a UUID reference in logs), voice clips (biometric), and defect photos
(may incidentally capture people). Controls: voice clips encrypted at rest with a 90-day retention
purge, inspection records retained 7 years and append-only, geolocation off by default, and no PII in
the audit chain. On the team demo the data is synthetic, so no real PII is present (ADR 0024).

## 11. Container hardening (as built and gaps)

As built:

- Every image runs as a non-root user (`USER appuser` in each service and app Dockerfile).
- Base images are pinned to explicit versions; no `latest` tag is used for infrastructure images.
- The AI Service has CPU and memory limits (`cpus`, `mem_limit`) in Compose (ADR 0017).

Gap to close before a SAIT production deployment: the Compose services do not yet set
`read_only: true` root filesystems with explicit `tmpfs` mounts, `cap_drop: [ALL]`, or
`security_opt: [no-new-privileges:true]`, and only the AI Service sets resource limits.
ARCHITECTURE.md section 8 and `SAIT_IT_BRIEF.md` describe these as the target hardening posture; they
are recommended for the production Compose and are not yet applied. This is listed here so a reviewer
sees the real state, not the intended state.

## 12. Dependency and static-analysis gates

Security controls are enforced in CI, not aspirational (`.github/workflows/security.yml`). Every push
and pull request to `main` runs:

- **Gitleaks**: secret scan over full history.
- **npm audit** through a cooldown-aware gate (`scripts/audit-gate.mjs`): fails on HIGH and CRITICAL
  advisories, tolerating only advisories whose fix is younger than the `.npmrc` release-age cooldown,
  each with a dated expiry.
- **Semgrep** (`--config=auto --error`): fails on any finding, including the OWASP and security-audit
  rulesets.
- **Trivy filesystem scan** (HIGH, CRITICAL, `ignore-unfixed`, cooldown allowlist in
  `.trivyignore.yaml`) and **Trivy config scan** of Dockerfiles.
- **Hadolint**: Dockerfile lint at the error threshold.

There is no bypass on `main`.

## 13. OWASP Top 10 posture (as built)

| Item                                     | Control                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A01 Broken Access Control                | Per-route `requireRole`, fail-closed boot guard (ADR 0014), roles not hierarchical              |
| A02 Cryptographic Failures               | TLS at Caddy, RSA-signed report exports (ADR 0022), no plaintext secrets                        |
| A03 Injection                            | Drizzle parameterized queries, Zod validation on every endpoint                                 |
| A04 Insecure Design                      | ADRs record decisions and residual risks explicitly                                             |
| A05 Security Misconfiguration            | Non-root images, pinned bases, boot-time env validation (ADR 0015); hardening gap in section 11 |
| A06 Vulnerable Components                | Trivy, npm audit gate, Semgrep, Renovate                                                        |
| A07 Authentication Failures              | Entra ID (MFA, Smart Lockout, conditional access at the tenant), short token life               |
| A08 Software and Data Integrity Failures | Immutability triggers, hash-chained audit + content digest (ADR 0008), signed exports           |
| A09 Logging and Monitoring Failures      | Azure Monitor, structured logs, no PII in logs, chain-break alerts                              |
| A10 SSRF                                 | The AI Service is reached only through core-api on the internal network (ADR 0019)              |

## 14. Threat model highlights

| Threat                                      | Mitigation                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator submits under another identity     | Identity comes from the validated token `oid`, not the body; short token lifetime (ADR 0007)                                                                           |
| Manager edits an inspection after the fact  | Inspections immutable (trigger); the audit chain seals a content digest, so a post-hoc edit is detectable (ADR 0008)                                                   |
| Forgotten role check ships an open endpoint | Fail-closed boot guard crashes the service before it serves (ADR 0014)                                                                                                 |
| ID token reused to authorize API calls      | The API requires an access token with the custom scope; the design records why the ID-token shortcut is wrong (ADR 0012)                                               |
| Stolen JWT used from another device         | Short token lifetime; identity from the validated token; request IP and User-Agent kept only in ephemeral Azure Monitor logs, never on the immutable record (ADR 0011) |
| Voice clip leak                             | Encrypted at rest, 90-day retention, reached only through core-api; never sent to an external AI API                                                                   |
| Tampered copy of an exported report         | Detached RSA signature over the file hash; recompute and verify against the recorded public key (ADR 0022)                                                             |
| Supply-chain (npm or pip) compromise        | Lockfile pinning, Trivy, npm audit gate, Semgrep                                                                                                                       |
| AI transcript hides a real failure          | Operator confirms the transcript; pass/fail is driven by structured items, never by note text                                                                          |

## 15. Deployment note

During the capstone the system runs in two forms: the containerized artifact (Docker Compose, dev and
mini-PC, with Caddy as the single front door) and a team-owned Azure demo. The Azure demo runs on
Azure Container Apps with Azure Front Door as the edge (TLS and `/api/v1` path routing), the managed
data tier (Azure Blob, Azure PostgreSQL Flexible Server, Azure Monitor), and synthetic data only
(ADR 0024). On Azure Container Apps the AI Service uses internal ingress, so it has no public route,
which preserves the ADR 0019/0020 rule without a reverse proxy, and the platform provides container
isolation, so the Compose hardening gap in section 11 applies to the self-hosted Compose artifact, not
to the Container Apps deployment. Moving to a SAIT-hosted deployment is an environment change (tenant
IDs, connection strings, app registration in the SAIT tenant, and recreating the resources in the SAIT
subscription), documented in `docs/runbooks/azure-deployment-and-entra-setup.md`. No application code
change is required.

## References

ADR 0002 (Entra ID), 0007 (attestation), 0008 (audit chain and content digest), 0011 (no device
fingerprint on the record), 0012 (access token via scope), 0014 (fail-closed route guard), 0015 (boot
env validation), 0016 (no SAIT-hosted production), 0017 (AI scaling), 0018 (advisory check), 0019
(PWA reaches the AI Service through core-api), 0020 (Caddy single front door), 0021 (auditor role),
0022 (detached report signature), 0024 (team-owned Azure demo). See also `docs/ARCHITECTURE.md`
section 8 and `SAIT_IT_BRIEF.md`.

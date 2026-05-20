# MAT Pre-Use Inspection System: Capstone Plan (v3)

**Sponsor:** SAIT School of Manufacturing, Automation, and Transportation (Main Campus)
**Team Size:** 5 students
**Timeline:** May 18, 2026 to August 15, 2026 (13 weeks, single semester)
**Hosting:** SAIT campus VM or SAIT cloud tenant (Microsoft Azure preferred), to be confirmed with campus IT
**Compliance Target:** Alberta OHS Code Part 19 (Powered Mobile Equipment), Part 6 (Cranes, Hoists, Lifting Devices), CSA B167, CSA B335
**Revision history:**

- v1: Two-semester plan, broad architecture
- v2: Tightened to one semester, AI removed
- v3: AI required by sponsor; voice-to-text feature added back to MVP
- v4: Added development staging infrastructure on team-owned hardware (Section 12.7); forced migration to school infrastructure made an explicit Sprint 4 deliverable
- v5 (this document): Reviewer feedback applied. Audit chain implementation specifics (Section 8.4), Whisper accuracy escalation path (Section 9.1), offline-first downgraded to short-drop tolerance (Section 10.1), SPOF acknowledgement with managed-services recommendation (Section 12.3), CI gates enforced with explicit severity thresholds (Section 14)

---

## 1. Executive Summary

The MAT Pre-Use Inspection System (working name: **MAT-Inspect**) replaces paper inspection sheets for ten pieces of high-risk equipment at SAIT Main Campus: 4 overhead cranes, 2 trucks, 1 electric pallet jack, and 3 forklifts.

Lab Techs scan a QR code on the equipment, complete an equipment-specific digital checklist on a mobile device, dictate defect notes by voice (transcribed by an on-prem AI service), and submit. The system stores a tamper-evident record, blocks unsafe equipment from being marked operational, and notifies supervisors. Managers see live compliance status on a dashboard. Auditors export signed PDF reports for any equipment and date range.

The system is built as a set of Docker-based microservices and deployed to SAIT-controlled infrastructure. All software is open source. The team writes four services (three Node.js, one Python for AI) plus two frontend apps. Production target date: August 15, 2026.

---

## 2. Problem-to-Solution Mapping

Every problem stated in the project brief maps to a specific system feature.

| Stated Problem                                             | System Feature That Solves It                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Inspection practices are inconsistent                      | Centralized checklist templates per equipment class, managed by Admin role                                     |
| Paper-based and often incomplete                           | Required-field validation; submission blocked if any required item is missing                                  |
| Missing records                                            | All submissions written to PostgreSQL with append-only audit log                                               |
| Limited accountability                                     | Every entry tied to authenticated user ID, timestamp, and device                                               |
| Cannot demonstrate compliance                              | Hash-chained audit log, signed PDF export, retention policy enforced by service                                |
| Managers cannot verify completion                          | Real-time dashboard with per-shift, per-equipment status                                                       |
| Lack of standardization                                    | Equipment-class checklists with versioning; checklist changes are tracked                                      |
| Safety risk from unsafe equipment                          | Failed inspection auto-sets equipment status to OUT_OF_SERVICE; return-to-service requires supervisor approval |
| Audit retrieval is difficult                               | Search by equipment, date range, operator, defect type; export to PDF or CSV                                   |
| Friction in capturing defect details (gloves, dirty hands) | Voice-to-text dictation for defect notes (AI Service, Whisper)                                                 |

---

## 3. Regulatory Anchors

The system design enforces these Alberta OHS requirements directly in code, not as policy notes.

**Part 19 (Powered Mobile Equipment), s.257:** Operator must complete visual inspection before operating equipment. s.257(4) prohibits starting operation if inspection is not completed.
**System enforcement:** Equipment status defaults to AWAITING_INSPECTION at shift start. Cannot transition to READY without a valid completed inspection record signed by an authorized operator within the shift window.

**Part 19, s.260:** Employer must ensure competent-worker inspections, hazard correction, and records kept at the worksite.
**System enforcement:** All inspections are stored on SAIT-controlled infrastructure. Records are retrievable on demand. Defect workflow tracks correction status.

**Part 6 (Cranes), Log book rules:** Each entry in an electronic log book must identify the person doing the work.
**System enforcement:** Every inspection record is cryptographically signed (HMAC) with the operator's authenticated session. Entries cannot be edited after submission; corrections create a new linked record.

**CSA B167 (Overhead Cranes), CSA B335 (Forklift Operator Training):** Operator competency requirements.
**System enforcement:** User profile stores certification expiry dates. Expired operators are blocked from submitting inspections for the class they are not currently certified for.

**Record retention:** Alberta OHS does not specify a hard minimum for inspection records, but the cross-jurisdiction best-practice default is 5 years. The system stores records for 7 years by default (configurable).

**Critical compliance note on AI:** Alberta OHS s.257 requires the _operator_ (a competent human) to complete the visual inspection. The AI Service in this system is assistive only: it transcribes voice notes and (optionally) suggests defect categories. It never auto-passes or auto-fails an inspection. Final judgement is always the operator's, recorded under the operator's signed identity.

---

## 4. Stakeholders and Roles

| Role                | Count              | Permissions                                                                                      |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| Operator (Lab Tech) | 6 to 7             | Scan equipment, submit inspections, upload defect photos, dictate defect notes, view own history |
| Supervisor          | 2 to 3             | All Operator rights, plus: approve return-to-service, view team dashboard, acknowledge defects   |
| Manager             | 1 to 2             | Full read access to all data, dashboard, reports, user management                                |
| Admin               | 1 (IT)             | System config, checklist template editor, user roles, integrations                               |
| Auditor             | 0 to 2 (read-only) | Read-only access to records and exports, time-boxed access                                       |

Roles are not hierarchical in code; they are explicit permission sets. A user can hold multiple roles.

---

## 5. System Architecture

### 5.1 High-Level View

```
                      +----------------------+
                      |   Operator (mobile)  |
                      |   PWA via QR scan    |
                      +----------+-----------+
                                 |
                      +----------+-----------+
                      | Manager (desktop)    |
                      | Dashboard SPA        |
                      +----------+-----------+
                                 |
                              HTTPS
                                 |
                      +----------v-----------+
                      |    Caddy             |
                      |    (TLS, ACME,       |
                      |    reverse proxy,    |
                      |    routing)          |
                      +-+--+--+--+--+--------+
                        |  |  |  |  |
       +----------------+  |  |  |  +-------------------+
       |                   |  |  |                      |
+------v---------+  +------v--+  +-v-------+   +--------v-------+
| Keycloak       |  | Core API |  | Audit / |   |  AI Service    |
| (auth, OIDC,   |  | Service  |  | Report  |   |  (Python,      |
| MFA, lockout)  |  | (Node.js)|  | Service |   |  FastAPI,      |
+------+---------+  +----+-----+  | (Node)  |   |  Whisper)      |
       |                 |        +----+----+   +--------+-------+
       |                 |             |                 |
+------v---------+       |             |                 |
| PostgreSQL     |       |   +---------v------+          |
| auth schema    |       |   |  Media Service |          |
+----------------+       |   |  (Node, MinIO  |          |
                         |   |  client)       |          |
+----------------+       |   +-------+--------+          |
| PostgreSQL     +<------+           |                   |
| core schema    |                   |                   |
+----------------+                   |                   |
                                     |                   |
+----------------+                   |                   |
| PostgreSQL     +<------------------+-------------------+
| audit schema   |
| (INSERT only)  |
+----------------+

+----------------+      +-----------------------+
| MinIO          |      | Observability         |
| (S3: photos,   |      | Prometheus, Grafana,  |
| voice clips,   |      | Loki, Promtail,       |
| PDF exports)   |      | Uptime Kuma           |
+----------------+      +-----------------------+
```

### 5.2 Microservices

Four services are built by the team. Three are off-the-shelf images with configuration only.

| Service                | Language / Framework              | Built by Team | Responsibility                                                                                  |
| ---------------------- | --------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| Caddy                  | image only                        | No            | TLS termination, reverse proxy, routing, ACME certs                                             |
| Keycloak               | image only                        | No            | OAuth2/OIDC, JWT issuance, user store, RBAC, MFA                                                |
| PostgreSQL             | image only                        | No            | Three logical schemas: auth (Keycloak), core, audit                                             |
| Core API Service       | Node.js + Fastify + TypeScript    | Yes           | Equipment registry, checklist templates, inspection submissions, defect workflow, notifications |
| Media Service          | Node.js + Fastify + TypeScript    | Yes           | Photo upload, voice clip upload, MinIO write, presigned URLs                                    |
| Audit / Report Service | Node.js + Fastify + TypeScript    | Yes           | Hash-chained audit log writer, PDF generation, CSV export                                       |
| AI Service             | Python + FastAPI + faster-whisper | Yes           | Voice-to-text transcription; (stretch) photo defect suggestion                                  |

**Why these boundaries:**

- Core API holds the business workflow and notifications. Notifications are embedded for the 13-week timeline; the code is structured so it can be extracted to its own service later.
- Media is separate because it handles binary uploads, has different scaling needs, and a different attack surface (file parsing).
- Audit is separate because its database has different durability and retention guarantees; isolation preserves legal evidentiary value.
- AI is separate because Python has different runtime needs from Node.js, the Whisper model is large (~500 MB) and warrants its own container lifecycle, and the rest of the system must continue to function if AI is down.

### 5.3 Data Stores

| Store                 | Purpose                                            | Notes                                           |
| --------------------- | -------------------------------------------------- | ----------------------------------------------- |
| PostgreSQL (auth_db)  | Keycloak data                                      | Managed by Keycloak                             |
| PostgreSQL (core_db)  | Equipment, checklists, inspections, defects        | Primary business data                           |
| PostgreSQL (audit_db) | Hash-chained audit log, retention metadata         | INSERT-only role; writes only via Audit Service |
| MinIO                 | Photo evidence, voice clips, generated PDF exports | S3-compatible, self-hosted                      |

Each schema is owned by a distinct database role with least-privilege grants.

---

## 6. Data Model (Core Entities)

```
Equipment
  id (uuid)
  asset_tag (string, unique, printed on QR sticker)
  type (enum: OVERHEAD_CRANE, TRUCK, ELECTRIC_PALLET_JACK, FORKLIFT)
  make, model, serial_number
  location (string, e.g., "Bay 3")
  status (enum: READY, AWAITING_INSPECTION, OUT_OF_SERVICE, RETIRED)
  current_status_since (timestamp)
  manufacturer_specs_url (optional)
  created_at, updated_at

ChecklistTemplate
  id (uuid)
  equipment_type (enum)
  version (int)
  is_active (bool)
  effective_from (timestamp)
  items (jsonb: ordered list of ChecklistItem)
  created_by (user_id)
  reviewed_by (user_id, optional)

ChecklistItem (embedded in template)
  key (string, stable)
  prompt (string)
  type (enum: BOOLEAN, BOOLEAN_PHOTO_ON_FAIL, MEASUREMENT, TEXT, SIGNATURE)
  required (bool)
  fail_severity (enum: BLOCKING, WARNING)
  regulatory_reference (string, optional, e.g., "OHS Part 19 s.257")

Inspection
  id (uuid)
  equipment_id (uuid)
  operator_id (uuid, from Auth)
  template_id (uuid)
  template_version (int)
  started_at, submitted_at (timestamps)
  shift_window_id (uuid)
  result (enum: PASS, FAIL_WARNING, FAIL_BLOCKING)
  signature_hmac (string)
  device_fingerprint (string, optional)

InspectionResponse
  id (uuid)
  inspection_id (uuid)
  item_key (string)
  value (jsonb)
  passed (bool)
  notes (text, optional)
  notes_source (enum: TYPED, VOICE_TRANSCRIBED, VOICE_EDITED)
  voice_clip_id (uuid, optional, references Media)
  photo_ids (uuid[], optional)

Defect
  id (uuid)
  inspection_id (uuid)
  equipment_id (uuid)
  item_key (string)
  severity (enum)
  description (text)
  photo_ids (uuid[])
  status (enum: OPEN, ACKNOWLEDGED, IN_REPAIR, RESOLVED, REJECTED)
  opened_at, resolved_at
  resolved_by (user_id)
  resolution_notes (text)
  return_to_service_approved_by (user_id, optional)

AuditEvent (audit_db, append-only)
  id (uuid, monotonic)
  prev_hash (string, sha256 of previous record)
  this_hash (string, sha256 of this record + prev_hash)
  timestamp (timestamptz)
  actor_id (uuid)
  action (enum: INSPECTION_SUBMITTED, DEFECT_OPENED, DEFECT_RESOLVED,
                EQUIPMENT_STATUS_CHANGED, CHECKLIST_PUBLISHED, USER_CREATED,
                VOICE_TRANSCRIBED, REPORT_EXPORTED, ...)
  resource_type, resource_id
  payload_summary (jsonb, redacted)

User (managed by Keycloak; mirrored shadow table in core_db for joins)
  id (uuid, matches Keycloak sub)
  display_name
  email
  certifications (jsonb: [{type, expires_at}])
  active (bool)
```

Database-level invariants:

- An Inspection with `result = PASS` cannot exist if any of its responses has `passed = false` and `fail_severity = BLOCKING`.
- An Equipment status of READY requires a recent passing Inspection within the shift window.
- AuditEvent rows are insert-only; trigger blocks UPDATE and DELETE.
- `notes_source = VOICE_TRANSCRIBED` requires a non-null `voice_clip_id`, and the operator must have had an opportunity to edit (UI enforces this; the value `VOICE_EDITED` records that they did).

---

## 7. User Flows

### 7.1 Operator: Pre-Use Inspection (with Voice Notes)

1. Operator scans the QR code on the equipment (PWA camera or native scanner).
2. PWA prompts login (Keycloak; if SAIT SSO is federated, transparently bounces to Microsoft Entra ID).
3. App loads the active ChecklistTemplate for the equipment type.
4. Operator works through items. For each failed item, the app shows a notes field with two options: type or **tap to dictate**.
5. If operator taps dictate: app records up to 30 seconds of audio, shows a waveform, then sends the clip to AI Service via Media Service (audio is stored, transcription returned).
6. Transcript appears in the notes field. Operator can edit. Final value plus `notes_source` (VOICE_TRANSCRIBED or VOICE_EDITED) is submitted.
7. Failed items also prompt for photo evidence.
8. On submit: client-side HMAC signature, submission over HTTPS, server validates, persists Inspection and Responses, writes AuditEvent, evaluates equipment status.
9. App displays result: green (READY) or red (OUT_OF_SERVICE with defect ID and lockout instructions).

### 7.2 Failed Inspection (Defect Path)

1. Submission contains a BLOCKING failure.
2. Core API creates Defect record, sets Equipment.status to OUT_OF_SERVICE.
3. Email sent to all Supervisors; push notification to on-shift Supervisors.
4. Audit Service writes EQUIPMENT_STATUS_CHANGED and DEFECT_OPENED events.
5. PWA displays a digital lockout tag.
6. Supervisor reviews defect, assigns to qualified person for repair.
7. After repair, supervisor approves return-to-service; equipment goes back to AWAITING_INSPECTION (a fresh passing inspection still required before READY).

### 7.3 Manager: Compliance Dashboard

1. Manager logs in to web dashboard.
2. Default view: today's compliance grid. Rows: each piece of equipment. Columns: last inspection time, operator, result, current status, open defects.
3. Filters: equipment type, location, date range, operator.
4. Drilldown: full inspection history with responses, photos, and voice clip playback (transcript displayed alongside audio).
5. Export: PDF or CSV.

### 7.4 Auditor: Compliance Export

1. Auditor logs in with time-boxed read-only access.
2. Selects equipment and date range.
3. Generates a signed PDF. PDF contains: per-inspection records, photos, voice transcripts (audio not embedded; transcripts only), signatures, audit log hash chain segment, system version.
4. PDF generated by Audit/Report Service; the file itself is digitally signed (PDF signature with the system's signing key).
5. PDF and its hash are stored in MinIO. AuditEvent records the export.

---

## 8. Security Architecture

### 8.1 Authentication

Keycloak as identity provider. Open source, OIDC compliant, supports federation with Microsoft Entra ID (SAIT's identity tenant), built-in user management, MFA, and lockout.

**SAIT SSO federation:** Pending decision from the campus IT meeting. The system supports both paths without code changes:

- **Path A (MVP default):** Local Keycloak users provisioned by Admin. Works on day one.
- **Path B (preferred long-term):** Keycloak as OIDC client of Microsoft Entra ID. Users sign in with SAIT credentials.

Switching paths is a Keycloak realm configuration change, no application code change.

Token policy:

- JWT access tokens, 15-minute lifetime.
- Refresh tokens, 7-day lifetime, rotated on use.
- MFA optional for Operator, required for Supervisor / Manager / Admin (Keycloak TOTP).
- Account lockout after 5 failed attempts.

### 8.2 Authorization (RBAC)

Two layers:

1. Caddy + Keycloak validate JWT signature and basic role claim.
2. Each service re-validates and enforces fine-grained permissions per endpoint via Casbin or a simple JSON policy.

Endpoints without a declared permission fail closed.

### 8.3 Transport and Storage Security

- TLS 1.3 everywhere. Caddy handles ACME for public hostnames, internal CA for campus-only deployments.
- Internal service traffic on a private Docker network, not exposed to host.
- Database connections use TLS.
- MinIO uses server-side encryption (SSE-S3).
- Secrets stored in Docker secrets (prod) or `.env` (dev only, never committed). For Azure deployment, secrets backend is Azure Key Vault.
- Database backups encrypted with age or GPG before transfer off-host.

### 8.4 Audit Log Integrity

The audit log is the legal record. Naive hash-chain implementations have five common failure modes that each break the chain's evidentiary value. The implementation below defends against each.

**Failure modes guarded against:**

- Non-deterministic JSON serialization (key-order changes → different hash for same data)
- Mutable fields contaminating the hash input (`updated_at` triggers re-hash)
- Concurrent inserts forking the chain (two writers compute hash against same `prev_hash`)
- Wrong hash construction (mixing `prev_hash` with `this_hash`, hashing wrong serialization)
- Timestamp inconsistency (different precision or timezone across services)

**Implementation rules:**

1. **Single writer.** Only the Audit Service has INSERT privilege on `audit_events`. Every other service emits an event over the bus or HTTP; Audit Service persists. No other path exists.

2. **Canonical JSON.** Hash inputs are serialized via RFC 8785 JSON Canonicalization Scheme (npm: `jcs`). Fixed key order, fixed number formatting, no whitespace. The same logical record always produces the same byte sequence.

3. **Immutable hash inputs only.** The hash input is exactly: `id`, `timestamp`, `actor_id`, `action`, `resource_type`, `resource_id`, `payload_summary`, `prev_hash`. Nothing else. No `updated_at`, no derived fields, no fields the database can change after insert.

4. **Timestamp normalization.** All timestamps in UTC, ISO 8601 with microsecond precision (`2026-05-19T18:31:42.123456Z`). One format, generated once on the writer side, never re-computed.

5. **Serialized chain extension.** Writers serialize on a Postgres advisory lock keyed on the chain identifier:

   ```sql
   BEGIN;
   SELECT pg_advisory_xact_lock(hashtext('audit_chain_v1'));
   SELECT this_hash AS prev_hash
     FROM audit_events
     ORDER BY id DESC LIMIT 1;
   -- application computes this_hash = sha256(canonical_json(event_fields) || prev_hash)
   INSERT INTO audit_events (id, prev_hash, this_hash, timestamp, actor_id, action,
                             resource_type, resource_id, payload_summary)
     VALUES (...);
   COMMIT;
   ```

   The advisory lock serializes the _chain extension_, not the whole table; the lock is released at COMMIT. Concurrent writers queue behind each other rather than racing.

6. **Defense-in-depth CHECK constraint.** A Postgres function `verify_audit_hash(event_row, prev_hash)` recomputes the hash from canonical JSON and the supplied `prev_hash`; a CHECK constraint on the table calls this function. Even if application code has a bug, the database rejects malformed entries.

7. **Chain verification.** On startup, Audit Service verifies the last 1000 events. A nightly job verifies the full chain. Any break triggers a CRITICAL alert to Admin and freezes new writes until manual review.

8. **No schema changes touch the chain.** Migrations on `audit_events` use a separate Postgres role (`audit_migrator`) and require an out-of-band approval. The migration role has DDL privileges only, not INSERT. Operational writes use the `audit_writer` role which has only INSERT.

This is the level of specificity required for the audit log to actually have evidentiary value in an Alberta OHS inspection.

### 8.5 AI-Specific Security Considerations

The AI Service introduces new threats. Mitigations:

- **Audio clips contain voice biometrics.** Treat as PII. Stored encrypted at rest in MinIO. Access logged. Retention: 90 days (transcripts kept for 7 years; audio is shorter-lived).
- **Prompt injection via voice:** Operators could speak instructions that try to manipulate downstream consumers of the transcript. Mitigation: the transcript is stored as plain text and never fed to an LLM in this version. If a future feature does feed transcripts to an LLM, treat them as untrusted input.
- **Model accuracy is not perfect.** Operator must confirm the transcript before submission. Schema requires `notes_source` field to track whether the operator edited the AI output.
- **AI Service runs locally on-prem.** Audio never leaves SAIT infrastructure. No third-party API calls. This satisfies likely FOIP requirements without requiring external data processing agreements.
- **AI Service failure must not block inspections.** PWA falls back to typed notes if the AI Service is unreachable. Status indicator shown to the user.

### 8.6 OWASP Top 10 Posture

| OWASP Item                                     | Mitigation                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A01 Broken Access Control                      | Declarative policy, fail-closed, per-endpoint checks                                       |
| A02 Cryptographic Failures                     | TLS 1.3, encrypted backups, no plaintext secrets                                           |
| A03 Injection                                  | Drizzle ORM (parameterized), Zod input validation                                          |
| A04 Insecure Design                            | This document; threat model session at start of Sprint 2                                   |
| A05 Security Misconfiguration                  | Hardened Docker images (Alpine), non-root, read-only root filesystem, dropped capabilities |
| A06 Vulnerable Components                      | Trivy on every build, Renovate, npm audit                                                  |
| A07 Identification and Authentication Failures | Keycloak, MFA for elevated roles, lockout                                                  |
| A08 Software and Data Integrity Failures       | Hash-chained audit, signed PDF exports                                                     |
| A09 Security Logging and Monitoring Failures   | Loki, alerts on suspicious patterns                                                        |
| A10 SSRF                                       | Allow-list URL fetching only                                                               |

### 8.7 Privacy (FOIP)

The system is hosted by SAIT; it falls under Alberta's Freedom of Information and Protection of Privacy Act (FOIP) and SAIT's institutional privacy policy.

PII inventory:

- Operator name, email
- Certification dates
- Voice clips (biometric)
- Photos (may incidentally capture faces or people)
- Optional geolocation (off by default)

Controls:

- Geolocation opt-in only.
- Data subject access: export-all-data-by-user-id endpoint.
- Retention: 7 years for inspection records; 90 days for raw voice audio (transcripts kept the full 7 years); per-user soft-delete preserves the audit trail.
- The team requests a FOIP review checklist from SAIT's privacy office in Sprint 0 and addresses any findings before pilot.

### 8.8 Threat Model Highlights

| Threat                                                        | Likelihood | Impact | Mitigation                                                                                                                                |
| ------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Operator forges a signature to bypass inspection              | Low        | High   | Server-side HMAC validation; session keys short-lived                                                                                     |
| Manager edits an inspection after the fact                    | Low        | High   | Inspections immutable; corrections are new linked records                                                                                 |
| QR code is replaced with a malicious one                      | Medium     | Medium | QR contains only non-secret asset_tag; server validates against registry; suspicious scan patterns alert Admin                            |
| Stolen JWT used from another device                           | Low        | Medium | Short token lifetime, device fingerprint logged                                                                                           |
| Database backup leaked                                        | Low        | High   | Backups encrypted at rest, transferred over SSH only                                                                                      |
| Voice clip leak                                               | Low        | High   | Encrypted at rest, 90-day retention, access logged                                                                                        |
| Supply chain (npm or pip package) compromise                  | Medium     | High   | Lockfile pinning, Trivy, audits                                                                                                           |
| AI transcript hallucinates a "pass" that masks a real failure | Low        | High   | Operator confirms transcript; transcripts are notes only, never drive pass/fail decisions; pass/fail driven by structured checklist items |

---

## 9. AI Component

### 9.1 Primary Feature: Voice-to-Text Defect Notes (MVP)

**Use case:** Lab Techs wearing gloves or with dirty hands struggle to type defect descriptions on a phone. Voice input is fast, hands-free, and natural.

**Implementation:**

- Model: **faster-whisper** with the `small` model (~500 MB, English-optimized variant `small.en`).
- Runtime: Python 3.12 + FastAPI in a Docker container. CPU-only inference (no GPU required for short clips of under 30 seconds).
- Endpoint: `POST /api/v1/ai/transcribe` accepts an audio blob (webm or wav, max 30 seconds, max 2 MB), returns `{transcript, confidence, language, processing_ms}`.
- Authentication: same JWT validation as other services.
- Audio handling: clip is uploaded to MinIO by Media Service first, then AI Service is given a presigned URL. AI Service streams the audio in, transcribes, returns. The clip is referenced by `voice_clip_id` in the Response record.

**Why this model:**

- Pre-trained, no training data required from the team.
- Open source (MIT), runs on-prem, satisfies privacy concerns.
- `small.en` accuracy on clean English audio in a quiet lab: word error rate of 5 to 10 percent. Operator review catches the rest.
- CPU inference of a 15-second clip on a 4-core VM completes in 3 to 5 seconds. Acceptable for UX.

**Operator UX guardrails:**

- Tap-to-record, tap-to-stop. Visual waveform during recording.
- Auto-stop at 30 seconds.
- After transcription, the text is editable. Operator must confirm before submission.
- `notes_source` field tracks whether the operator edited the AI output (this matters for compliance audits).
- If AI Service is down or returns an error, fall back gracefully to typed notes. The operator is never blocked by AI failure.

**Accuracy tuning and escalation path:**

- A `confidence_threshold` config (default 0.6) flags any transcript below it with a "review carefully" warning in the PWA.
- During Sprint 0's equipment walkaround, the team records 10 to 15 second test clips in the actual MAT lab with typical background noise. Run them through `small.en` and compute word error rate against ground-truth transcripts. If WER exceeds 20 percent, escalate before Sprint 3.
- Escalation options if accuracy is poor in real conditions:
  1. **Tune the confidence threshold up** (e.g., 0.75): more clips get flagged for review, fewer auto-accepted; quality goes up, perceived AI value goes down.
  2. **Move to `medium.en`** (769 MB model, ~3 GB RAM): meaningfully better accuracy but 3x slower on CPU. Requires a larger VM (16 GB RAM, 4 vCPU; roughly double the Azure cost) or a GPU-enabled VM.
  3. **Pre-processing step:** add a noise reduction pass (e.g., `rnnoise` via WebAssembly on the client before upload). Free, ~200 KB to ship.
  4. **Accept that typed notes are the primary path** and AI is a "nice to have." This is always the floor; the system never depends on AI accuracy.
- The Sprint 0 acoustic test result is recorded in an ADR so the decision is defensible at capstone presentation.

### 9.2 Secondary Feature: Photo Defect Hint (Stretch, only if Sprint 3 finishes early)

**Use case:** When operator uploads a photo of a defect, AI suggests a category (tire wear, hydraulic leak, structural damage, oil contamination). Operator confirms or overrides.

**Implementation:**

- Model: a pre-trained vision model (CLIP zero-shot classifier, or a small ViT fine-tuned on an open industrial-defect dataset like NEU surface defects). CLIP zero-shot is the faster path because no fine-tuning is needed.
- Endpoint: `POST /api/v1/ai/classify-defect-photo` returns `{suggested_category, confidence, alternatives: [...]}`.
- Suggestions are advisory only. The structured `item_key` is set by the checklist item, not by the AI.

This feature is explicitly out of MVP scope and only attempted if the team finishes Sprint 3 work ahead of schedule.

### 9.3 Out of Scope for Capstone

- AI grading of inspection quality.
- Anomaly detection on inspection trends (needs historical data the team will not have at launch).
- LLM-generated defect summaries for managers.
- Speaker identification or voice biometric authentication.

### 9.4 AI Failure Mode (Architecturally Mandatory)

The AI Service is _never_ on the critical path of an inspection submission. If it is offline:

- PWA detects the failure (timeout or HTTP error) and shows a "voice unavailable, type your notes" message.
- Submission proceeds normally with typed notes.
- Equipment status is unaffected.
- Inspection record records `notes_source = TYPED`.

This isolation is enforced by the fact that AI Service is a separate container with its own health check; nothing else depends on its uptime.

---

## 10. Frontend Design

### 10.1 Operator PWA

- Framework: **Next.js 15+** with App Router.
- Mobile-first. Large tap targets, glove-friendly.
- **Connectivity model: tolerant of short network drops, not full offline-first.** Assumes reliable WiFi or LTE in the lab (confirmed at client meeting; Section 6 of the meeting questions makes WiFi coverage a hard requirement for project go-ahead). The PWA tolerates drops up to roughly 15 minutes by queueing submissions in memory and retrying on reconnection.
  - Optimistic UI: operator sees "Submitted, syncing..." immediately on tap; the actual POST happens in the background with retry.
  - Idempotency-Key is generated client-side at tap time, so retries do not create duplicates.
  - Photos and voice clips are uploaded with exponential backoff (1s, 2s, 4s, 8s, then user-visible error).
  - If a submission cannot reach the server after 15 minutes, the operator sees a clear failure state and is asked to retry manually. The submission payload is preserved in `sessionStorage` so a page refresh does not lose data.
  - This is intentionally simpler than full IndexedDB offline-first persistence. Saves an estimated 3 to 5 days of Sprint 3 work.
- If pilot reveals connectivity issues that the short-drop model does not cover, **escalate to full offline-first in v2.** Not for capstone.
- Checklists are cached on first load via standard HTTP caching (1 hour TTL), not via service worker, to keep the implementation simple.
- QR scanner: `html5-qrcode` via `getUserMedia`.
- Audio capture: `MediaRecorder` API, webm/opus codec.
- State: Zustand.
- Styling: Tailwind CSS.
- Components: shadcn/ui.

### 10.2 Manager Dashboard

- Framework: Next.js 15+ App Router, same monorepo, separate route group.
- Server-side rendering for initial load; client-side for interactive grids.
- Charts: Recharts.
- Tables: TanStack Table.
- Auth: same Keycloak client family, different client ID with elevated scopes.

### 10.3 Accessibility

WCAG 2.1 AA. High-contrast theme. Keyboard navigation on dashboard. Color is never the sole indicator (icon + label + color for status).

---

## 11. API Design

REST, all endpoints under `/api/v1/`. Errors follow RFC 7807. Pagination is cursor-based. Idempotency-Key header accepted on writes.

### 11.1 Sample Endpoints

```
POST   /api/v1/inspections                       Submit a completed inspection
GET    /api/v1/inspections?equipment_id=...      List inspections (paginated)
GET    /api/v1/inspections/:id                    Get one inspection
GET    /api/v1/equipment                          List equipment with status
GET    /api/v1/equipment/:asset_tag               Resolve QR to equipment record
PATCH  /api/v1/equipment/:id/status               Change status (Supervisor+)
GET    /api/v1/checklists/active?type=FORKLIFT    Active checklist template
POST   /api/v1/defects/:id/resolve                Mark defect resolved (Supervisor+)
POST   /api/v1/media/upload                       Upload photo or voice clip (Media Service)
POST   /api/v1/ai/transcribe                      Transcribe a voice clip (AI Service)
POST   /api/v1/reports/export                     Generate a PDF report (async)
GET    /api/v1/reports/:job_id                    Poll report job status
```

All endpoints have OpenAPI specs generated from Zod schemas (`zod-to-openapi`).

---

## 12. Deployment

### 12.1 Environments

| Environment                | Purpose                                                          | Hosting                                                                  |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Local dev                  | Each student's laptop                                            | Docker Compose, single host                                              |
| Dev staging                | Shared environment for daily integration testing; fake data only | Team-owned mini-PC on Tailscale (Sprint 0 to Sprint 4); see Section 12.7 |
| Pilot / Production staging | Sprint 5 pilot with real Lab Tech data; production deployment    | SAIT campus VM or SAIT Azure tenant (provisioned in Sprint 4)            |
| Production                 | Live use at SAIT                                                 | SAIT campus VM or SAIT Azure tenant                                      |

### 12.2 Hosting Options

The system is deployed to SAIT-controlled infrastructure. The team will confirm the target with campus IT during Sprint 0. In order of preference:

**Option A: Microsoft Azure (SAIT institutional tenant).**
A VM (Standard B2ms: 2 vCPU, 8 GB RAM, 64 GB SSD) under SAIT's existing Microsoft 365 / Azure tenancy. Pros: SAIT already runs on Microsoft; SSO with Entra ID is straightforward; managed snapshots, backups, and monitoring; Key Vault for secrets; Blob Storage for backup target. Cons: recurring cost (modest, around CAD $80 to $120 per month for B2ms); requires institutional approval.

**Option B: SAIT campus VM.**
A VM inside the campus network provisioned by SAIT IT. Pros: data stays on-prem; simplest FOIP story; no recurring cloud cost. Cons: SAIT IT must maintain; team needs VPN access during development.

**Option C: AWS Educate.**
A VM in AWS under an educational account if available. Functionally similar to Azure. SSO is more work (Entra-to-AWS federation). Choose only if Options A and B are unavailable.

**The AI Service tightens the spec slightly.** Whisper `small.en` needs 1.5 GB RAM in process and benefits from at least 2 vCPU. A 4 GB VM is tight; 8 GB is comfortable. Recommend asking for 8 GB.

### 12.3 Production Topology and Single-Point-of-Failure Posture

**Honest assessment:** a single-VM deployment is a single point of failure. If the VM dies mid-shift, no inspections can be submitted. For a system that enforces equipment safety in an industrial training environment, that matters.

The capstone scope cannot deliver active-active high availability. But the architecture supports a meaningful posture improvement at low cost: **move the persistent layer to managed services on Azure, keep the stateless services on one VM.**

**Recommended production posture (Azure path):**

| Component                                                        | Hosting                                                              | Reason                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Postgres                                                         | Azure Database for PostgreSQL (Flexible Server, Burstable B1ms tier) | Managed backups, point-in-time recovery, automated patching, replicated storage   |
| Object storage (photos, voice clips, PDF exports)                | Azure Blob Storage with lifecycle policies                           | Geo-redundant storage, automated tiering, no self-hosted MinIO operational burden |
| Stateless services (Caddy, Keycloak, Core API, Media, Audit, AI) | Single Azure VM (Standard B2ms: 2 vCPU, 8 GB RAM)                    | Capstone-scope deployment; can be rebuilt in under 1 hour from Git + scripts      |
| Observability (Prometheus, Grafana, Loki, Promtail)              | Same VM                                                              | Loss of monitoring during the rebuild window is acceptable for capstone scope     |

This eliminates the worst SPOF (the data layer). If the VM dies, a replacement is spun up, pulls the same code from Git, points at the same managed Postgres and Blob Storage, and the system is back without data loss.

**Recommended production posture (campus VM path, if Azure is not available):**

| Component       | Hosting                                                                                                                                                               | Reason                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Postgres        | Docker container on the campus VM, **but with PITR backup configured** to a SAIT-managed off-host target (e.g., NFS share, S3, Azure Blob, whatever SAIT IT provides) | Continuous WAL archiving so RPO is minutes, not 24 hours |
| Object storage  | Self-hosted MinIO with daily `mc mirror` to a SAIT-managed backup target                                                                                              |                                                          |
| Everything else | Same VM                                                                                                                                                               |                                                          |

The campus path has more residual SPOF than the Azure path. If campus is the only option, document this explicitly to the sponsor and SAIT IT.

**Stack composition (containers running on the VM, either path):**

- Caddy (1 container)
- Keycloak (1 container)
- Core API (1 container)
- Media Service (1 container)
- Audit / Report Service (1 container)
- AI Service (1 container)
- Prometheus, Grafana, Loki, Promtail (4 containers)
- Uptime Kuma (1 container)

On the Azure path, Postgres and MinIO are NOT in this list (they are managed services). On the campus path, add 1 Postgres container + 1 MinIO container (total 12 containers).

**Memory budget on an 8 GB VM (Azure path with managed DB/storage):**

- Keycloak ~700 MB
- AI Service (Whisper loaded) ~1.5 GB
- Each Node service ~150 MB (3 services = ~450 MB)
- Caddy, Prometheus, Grafana, Loki, Promtail, Uptime Kuma combined ~1 GB
- Total ~3.7 GB, leaving 4.3 GB of headroom (more on the Azure path because Postgres and MinIO are not in-process).

Staging runs the same compose file on a second instance (or a second resource group on Azure).

### 12.4 Reverse Proxy and TLS

Caddy:

- **Public hostname** (e.g., `mat-inspect.sait.ca`): Let's Encrypt via ACME. DNS managed by SAIT IT.
- **Campus-internal hostname**: internal CA root cert provided by SAIT IT, or Caddy's built-in local CA with root cert distributed via SAIT device management.

### 12.5 Backup Strategy

**Azure path:**

- Postgres: managed automated backups with point-in-time recovery, 7-day retention default, configurable up to 35 days
- Blob Storage: GRS (geo-redundant) replication by default
- Configuration: All in Git. No unique server state outside the managed services.

**Campus VM path:**

- Postgres: `pg_dump` nightly + WAL archiving every 5 minutes to off-host storage. RPO ~5 minutes.
- MinIO: `mc mirror` nightly to off-host target.
- Configuration: All in Git.

**Restore drill cadence:** documented and **tested twice**, once in Sprint 4 and again in the week before production cutover in Sprint 6. A restore that worked in July does not prove a restore works in August; configurations drift.

### 12.6 Disaster Recovery

**RPO (Recovery Point Objective):**

- Azure path: under 5 minutes (PITR on managed Postgres)
- Campus path: under 5 minutes if WAL archiving is set up; otherwise 24 hours

**RTO (Recovery Time Objective):**

- Azure path: 1 hour to rebuild the stateless VM; data is already preserved
- Campus path: 4 hours on a replacement VM with the documented runbook

**DR runbook contents:**

- Step-by-step rebuild procedure
- Where backups live and how to restore them
- DNS update steps (if hostname needs to point to a new IP)
- Smoke-test checklist (verify each service is functional)
- Contact list (SAIT IT, sponsor, Anthropic Azure support if applicable)

The runbook is rehearsed in Sprint 4 and Sprint 6 (week before cutover), and delivered at handover.

### 12.7 Development Staging Infrastructure

To accelerate development and avoid waiting on campus IT to provision dev hardware, the team uses a member-owned mini-PC as a shared dev staging environment for the first four sprints. This is dev infrastructure only, not production. Real Lab Tech data never lands on this host.

**Host:** GMKtec M5 Plus (Ryzen 7 5825U, 32 GB RAM, Ubuntu 24.04), owned by a team member, reachable via Tailscale.

**What this environment is used for:**

- Daily integration testing of merged code
- Sponsor demos at end of each sprint (Sprint 0 through Sprint 4)
- The team's "Stephen-is-not-available" recovery drill (Sprint 2)
- Whisper model performance baseline measurements

**What this environment is NOT used for:**

- Real Lab Tech inspections (Sprint 5 pilot must run on SAIT infrastructure)
- Any data that falls under SAIT's institutional records or FOIP scope
- Persistent storage of credentials beyond the project's own service accounts

**Access pattern:**

- All 5 team members are added to the host owner's Tailscale tailnet, scoped to the project.
- SSH access via Tailscale only; no public ports.
- CI/CD: GitHub Actions deploys to the host over SSH on every merge to `main` (continuous deployment to dev staging).

**Isolation from host owner's existing services:**

- The MAT project lives in `~/projects/mat-inspect/` with its own Docker Compose file, its own Caddy container (on host ports 80 and 443), its own Postgres, its own MinIO, its own Keycloak, its own observability stack.
- All project services except Caddy stay on the project's internal Docker network and are not exposed to the host.
- The project does not reuse the host owner's personal homelab services (Gitea, personal Prometheus, etc.). Keeping the project self-contained makes the Sprint 4 migration a single-command lift.

**Caddy and HTTPS on dev staging:**

- The project's Caddy container uses its built-in local CA. On first start, `docker compose exec caddy caddy trust` generates the root cert.
- The root cert is distributed to all 5 team members; they install it on their dev devices.
- Hostnames: `mat-inspect.staging` and similar, mapped to the Tailscale IP via each user's `/etc/hosts` or via Tailscale MagicDNS.

**Shared secrets:**

- Bitwarden cloud (free tier, or 1Password Teams via student plan if available) hosts the shared collection for team credentials (Keycloak admin, SMTP, database passwords, deploy keys).
- `.env` files live in each developer's local checkout, never committed. The same Gitleaks pre-commit pattern used elsewhere prevents accidental commits.
- On the M5 dev staging host, the `.env` file sits in the project directory, readable only by the deploy user.

**Backups during dev staging phase:**

- The host owner's existing rsync nightly backup is extended to include the project directory.
- Database dumps run nightly inside the project's compose stack and write to the same backup target.
- Backups are recovery for dev work only; they are not the system of record (the system of record is Git for code and the Sprint 5+ Azure/campus VM for data).

**Sprint 4 migration (forced rehearsal):**

- The migration to SAIT infrastructure is an explicit Sprint 4 deliverable, not a stretch task.
- Migration steps: `pg_dump` of all three schemas, `mc mirror` of MinIO, `git pull` on the target VM, `docker compose up -d`, restore dumps, smoke test.
- After Sprint 4, dev staging on the M5 continues for parallel team work but loses its sponsor-demo role. All sponsor demos from Sprint 5 onward use the SAIT-hosted instance.

**End-of-project decommission:**

- After capstone presentation (Aug 15, 2026), the M5 staging instance is shut down and its project directory archived.
- No project data is retained on team-owned hardware post-handover.

---

## 13. Observability

| Concern    | Tool                 | Notes                                                                         |
| ---------- | -------------------- | ----------------------------------------------------------------------------- |
| Metrics    | Prometheus           | Service health, request rates, error rates, AI transcription latency          |
| Dashboards | Grafana              | Per-service dashboards, compliance KPIs                                       |
| Logs       | Loki + Promtail      | Structured JSON logs, 30-day retention                                        |
| Uptime     | Uptime Kuma          | External-style ping checks                                                    |
| Alerts     | Alertmanager + email | Service down, audit chain break, disk full, AI Service errors above threshold |

Logs are structured JSON. No PII (user IDs only, never names; equipment IDs only).

Distributed tracing is deferred; request ID correlation in logs is sufficient at this scale.

---

## 14. CI/CD Pipeline

GitHub-hosted (free Actions minutes for the educational case). **Security controls are enforced in CI, not aspirational.** The pipeline fails the build if any rule is violated; there is no `--no-verify`-style escape hatch on `main`.

### 14.1 Mandatory Pipeline Stages

Every PR and every push to `main` runs all stages. Build fails if any stage fails.

1. **Lint and format.** ESLint, Prettier (TypeScript); Ruff (Python); Hadolint (Dockerfiles); Markdownlint (docs). Zero warnings allowed.
2. **Type check.** TypeScript strict mode for all TS code; mypy strict for Python. No errors allowed.
3. **Unit tests.** Vitest (TS), pytest (Python). 70 percent coverage target for business logic in `services/*/src/use-cases/`, `services/*/src/domain/`, and `packages/*/src/`. No coverage requirement on glue code.
4. **Integration tests.** Postgres and MinIO (or Azurite for Azure Blob) in containers via testcontainers; tests run against real dependencies, not mocks.
5. **Build container image.** Multi-stage Dockerfile, non-root user, Alpine base for Node services; `python:3.12-slim` for AI Service. Hadolint must pass.
6. **Security scans (each is a build gate):**
   - **Trivy** on the built image: fails on HIGH or CRITICAL CVEs with available patches. MEDIUM and below logged but not blocking.
   - **Semgrep** on the source: fails on findings from `p/owasp-top-ten` and `p/security-audit` rulesets at HIGH severity.
   - **Gitleaks** on git history (full history scan): any secret detection fails the build.
   - **npm audit** / **pip-audit**: fails on HIGH or CRITICAL with an available patch. Documented exception process for CVEs with no patch available.
7. **Push image** to GitHub Container Registry on success, tagged with the git commit SHA and (for `main`) `latest`.
8. **Deploy to dev staging** on merge to `main`: SSH to the M5 over Tailscale, `git pull && docker compose pull && docker compose up -d`. Smoke test runs after; failure rolls back automatically.
9. **Deploy to production** on tag push (e.g., `v0.1.0`): manual approval required from a Manager-role team member; otherwise identical to staging deploy.

### 14.2 Branch Protection

Configured on `main` and enforced by GitHub:

- Required status checks: lint, type-check, unit-tests, integration-tests, trivy, semgrep, gitleaks, build
- Require pull request before merge
- Require 1 approval (2 for paths in CODEOWNERS, see Section 8)
- Dismiss stale approvals when new commits are pushed
- Require linear history (rebase or squash; no merge commits)
- Block force push
- Block deletion

CODEOWNERS enforces two-reviewer requirement on:

- `services/audit/`
- `services/core-api/src/middleware/auth.ts`
- `services/core-api/src/lib/hmac.ts`
- `services/core-api/src/domain/inspection.ts`
- `db/migrations/`

### 14.3 Dockerfile Rules (enforced by Hadolint)

Every Dockerfile in the repo must:

- Use a pinned base image version, never `latest`
- Run as a non-root user: `USER nonroot:nonroot` or a numeric UID/GID
- Use multi-stage builds: build dependencies isolated from runtime image
- Not install build tools in the final stage
- Use `COPY` not `ADD` (unless extracting an archive)
- Set a `HEALTHCHECK` instruction

Docker Compose adds:

- `read_only: true` on the root filesystem; explicit `tmpfs` mounts for what needs to write
- `cap_drop: [ALL]` then `cap_add` only what is needed
- `security_opt: [no-new-privileges:true]`
- No `privileged: true`
- Resource limits: `mem_limit` and `cpus` set on each service

### 14.4 Secrets Management

| Environment            | Secret store                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Local dev              | `.env` files (gitignored; covered by Gitleaks pre-commit)                           |
| Dev staging (M5)       | `.env` files on the host, readable only by the deploy user; never committed         |
| Production (Azure)     | Azure Key Vault; injected into containers at startup via the Azure SDK or a sidecar |
| Production (campus VM) | Docker Secrets, file-based; rotated quarterly                                       |
| CI                     | GitHub Secrets, scoped per environment (dev-staging, production)                    |

**Never use `.env` files in production.** Hardcoded values, including for "convenience," are a CVE waiting to happen.

### 14.5 Operations: Dependency and Vulnerability Management

- **Renovate** (or Dependabot) enabled with weekly grouped PRs. Patch and minor updates auto-merged after CI passes; major updates require human review.
- **CVE SLA:** HIGH or CRITICAL with an available patch must be merged within **7 calendar days** of detection. Tracked in a dedicated GitHub Project board.
- **Monthly security review** (30 minutes, team meeting): walk through Renovate alerts, Trivy historical reports, audit log integrity verification logs. One team member presents; rotates each month.

### 14.6 Branching

Trunk-based, short-lived feature branches. PRs require 1 review and all checks green (or 2 reviewers for CODEOWNERS-protected paths). Squash and merge to `main`. No long-lived branches.

---

## 15. Implementation Plan (13 Weeks, May 18 to August 15, 2026)

Five 2-week sprints, then three 1-week sprints. Sprint demo to sponsor at each end.

### Sprint 0: Discovery and Setup

**Weeks 1 to 2 (May 18 to May 31)**

- Stakeholder interviews; job shadow at least 2 inspections per equipment type.
- Confirm checklist content with sponsor for all four equipment classes. Photograph or transcribe all existing paper checklists.
- Campus IT meeting: confirm hosting option, SSO path, request FOIP checklist.
- Repo set up on GitHub. Branch protection, PR template, issue templates.
- Docker Compose skeleton: Postgres, MinIO, Keycloak, Caddy, stubs for Core API, Media, Audit, AI.
- Each student gets the stack running locally.
- Dev staging set up on team-owned mini-PC (see Section 12.7); all 5 students added to Tailscale; root cert distributed.
- Bitwarden shared collection created; service credentials added; all team members onboarded.
- GitHub Actions configured to deploy to dev staging on merge to `main`.
- Initial ADRs: Fastify over Express, Drizzle over Prisma, Whisper variant choice (`small.en`), database strategy, hosting target, dev staging on team-owned hardware with explicit constraints.
- CI pipeline green on first commit.

**Sprint 0 demo target:** stack runs locally and on dev staging; checklists confirmed; hosting decision documented; AI Service stub returns a hardcoded transcript; team can reach dev staging via Tailscale with no browser warnings.

### Sprint 1: Auth, Equipment Registry, Checklist Engine

**Weeks 3 to 4 (June 1 to June 14)**

- Keycloak realm configured. Roles defined. Test users provisioned.
- Core API: Equipment CRUD endpoints; seed data for the 10 machines.
- ChecklistTemplate model and admin publish endpoint.
- Checklist templates entered for all four equipment classes; reviewed by sponsor.
- PWA shell: login flow, QR scan, equipment lookup, checklist render.
- Threat model session with the whole team.

**Sprint 1 demo:** Operator logs in, scans a QR, sees the correct checklist for that equipment.

### Sprint 2: Inspection Submission and Defect Workflow

**Weeks 5 to 6 (June 15 to June 28)**

- Inspection submission endpoint with HMAC validation.
- Equipment status state machine.
- Defect entity and workflow. Failed inspection auto-creates Defect and locks equipment.
- Notifications: SMTP email for failed inspections.
- Lockout tag screen in PWA.
- AuditEvent writing (basic, hash chain in Sprint 4).

**Sprint 2 demo:** End-to-end pass and fail flows. Supervisor receives email on failure.

### Sprint 3: Manager Dashboard, Photo Evidence, **AI Voice-to-Text**

**Weeks 7 to 8 (June 29 to July 12)**

- Manager dashboard: live compliance grid, defect inbox, filters, drilldown.
- Media Service: photo upload and presigned URL download.
- PWA photo capture on failed items.
- **AI Service deployed**: faster-whisper `small.en` in a Docker container, `/api/v1/ai/transcribe` endpoint, authentication, MinIO integration.
- PWA voice dictation UI: tap-to-record, waveform, transcript display, edit-and-confirm flow.
- Supervisor flow: acknowledge defect, approve return-to-service.

**Sprint 3 demo:** Manager sees today's compliance. Operator dictates a defect note that appears as text. Voice clip is replayable in dashboard.

### Sprint 4: Audit, Reporting, Hardening, **SAIT Infrastructure Migration**

**Weeks 9 to 10 (July 13 to July 26)**

- Audit Service with hash-chained log writing; chain verification on startup.
- PDF report generation (PDFKit). Per-inspection PDF and range exports. Signed PDFs.
- CSV export.
- Retention policy: 7 years for records, 90 days for raw voice audio (lifecycle job).
- Security review: Trivy, Semgrep, Gitleaks across whole repo. Fix high and critical findings.
- Internal pen test: students swap roles and attack each other's services.
- Backup automation: nightly pg_dump + MinIO mirror.
- DR runbook drafted; restore drill on staging.
- **Provision SAIT-hosted VM (Azure or campus) per the Sprint 0 decision.**
- **Migrate the stack from team-owned dev staging to SAIT infrastructure.** Steps: `pg_dump` all three schemas, `mc mirror` MinIO, `git pull` on target VM, `docker compose up -d`, restore dumps, end-to-end smoke test.
- **Verify the SAIT instance handles a full inspection flow end to end before Sprint 5 begins.** This is the gate to the pilot.

**Sprint 4 demo:** Auditor exports a signed PDF from the SAIT-hosted instance. Backups run. Security scan clean. Migration runbook documented and rehearsed.

### Sprint 5: Pilot

**Week 11 (July 27 to August 2)**

- Deploy to staging on the production-equivalent host.
- Pilot with one shift of Lab Techs on real equipment. Target: 20+ real inspections.
- Daily standup with sponsor.
- Same-day bug turnaround for critical issues.

**Sprint 5 demo:** Lab Techs use the system live for one week.

### Sprint 6: Production Rollout

**Week 12 (August 3 to August 9)**

- Production deployment to the confirmed SAIT host.
- DNS and TLS configured.
- QR stickers printed and applied to all 10 machines.
- All Lab Techs trained (30-min session). Supervisors trained (1 hour). Managers trained (1 hour).
- Cutover from paper to digital. Paper kept as fallback for the first three days only.

**Sprint 6 target:** all 10 machines tagged and live.

### Sprint 7: Stabilization and Handover

**Week 13 (August 10 to August 15)**

- Real-world bug fixes from the first production week.
- Final documentation: README, SETUP, DEPLOYMENT, SECURITY, OPERATIONS_RUNBOOK, OPERATOR_GUIDE (1 page), SUPERVISOR_GUIDE (2 pages), ADMIN_GUIDE (5 pages).
- Source code, deploy scripts, secrets handover process, runbook delivered to SAIT IT.
- Capstone presentation prepared and delivered.

**Final deliverable date: August 15, 2026.**

---

## 16. Team Allocation (5 Students)

| Student                      | Owns                                                                                           | Backs Up                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Backend Lead**             | Core API, data model, API contracts, state machine                                             | Audit Service                                |
| **Backend Engineer 2**       | Keycloak integration, Media Service, notifications                                             | Core API                                     |
| **Frontend Lead**            | Operator PWA, QR scan, offline, **voice capture UI**                                           | Manager dashboard                            |
| **Frontend Engineer 2 / UX** | Manager dashboard, accessibility, UI consistency                                               | Operator PWA                                 |
| **DevOps / QA / AI**         | Docker, CI/CD, observability, Audit Service, **AI Service**, integration tests, security scans | Whichever backend service is behind schedule |

The AI Service is owned by the DevOps / QA / AI student because it is a Python service with limited business logic. Voice capture UI is owned by the Frontend Lead because it integrates tightly with the PWA recording flow.

Cadence:

- Daily 15-minute standup.
- Weekly 1-hour planning.
- Sponsor demo at end of each sprint.

---

## 17. Documentation Deliverables

Bundled with the source code at handover.

1. **README.md**: One-page overview, quick start.
2. **SETUP.md**: Run locally, prerequisites, troubleshooting.
3. **ARCHITECTURE.md**: This document, kept current.
4. **API_REFERENCE.md**: Generated from OpenAPI spec.
5. **DEPLOYMENT.md**: Production deployment, TLS, backup, restore.
6. **SECURITY.md**: Threat model, controls, incident response contacts.
7. **OPERATIONS_RUNBOOK.md**: Common incidents and responses.
8. **AI_MODEL_CARD.md**: Whisper model variant, accuracy expectations, known limitations, fallback behavior.
9. **OPERATOR_GUIDE.pdf**: One page with screenshots, for Lab Techs.
10. **SUPERVISOR_GUIDE.pdf**: Two pages, for Supervisors.
11. **ADMIN_GUIDE.pdf**: Five pages, for the SAIT IT inheritor.
12. **ADRs** (`/docs/adr/`): Architecture Decision Records for each major choice.

---

## 18. Risks and Mitigations

| Risk                                                                                   | Likelihood | Impact | Mitigation                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sponsor checklist content not finalized in time                                        | High       | Medium | Lock content by end of Week 4; document explicit decision deadlines                                                                                                        |
| Campus IT delays hosting approval beyond Sprint 4                                      | Medium     | High   | Dev staging on team-owned mini-PC bridges Sprint 0 to 4; if SAIT VM is not ready by Week 9, escalate to sponsor immediately because Sprint 5 pilot cannot start without it |
| SSO federation decision delayed beyond Sprint 0                                        | Medium     | Low    | Default to local Keycloak users; switch is a config change, no code rework                                                                                                 |
| Team learning curve on Keycloak / Docker / Whisper                                     | High       | Medium | Two weeks of guided ramp-up in Sprint 0; pair programming on first integration                                                                                             |
| Real Lab Tech availability for testing                                                 | Medium     | High   | Schedule test sessions in advance; build a fake-equipment test rig if needed                                                                                               |
| Scope creep from sponsor                                                               | Medium     | High   | Out-of-scope document, change request process, defer to v2                                                                                                                 |
| Whisper accuracy too low to be useful in a loud shop                                   | Medium     | Medium | Quiet the operator (move 2 metres from equipment to dictate); fallback to typed notes is always available; document accuracy expectations in AI Model Card                 |
| AI Service slows the inspection flow                                                   | Low        | Medium | Transcription is non-blocking; PWA shows immediate placeholder, transcript fills in when ready; operator can still type while waiting                                      |
| One student leaves the project                                                         | Low        | High   | Cross-training, every feature has a backup owner                                                                                                                           |
| Audit chain bug undermines legal value                                                 | Low        | High   | Code review by 2 students, integration test with 10,000 simulated events that verifies chain                                                                               |
| Team-owned mini-PC fails or its owner becomes unavailable                              | Low        | Medium | Everything in Git; any teammate can rebuild the staging stack on their laptop with `docker compose up`; Sprint 2 includes a recovery drill that proves this works          |
| Sprint 4 migration to SAIT infrastructure reveals environment-specific bugs            | Medium     | Medium | Migration is an explicit Sprint 4 deliverable, not Sprint 6; two full weeks of buffer to fix any environment-specific issues before pilot                                  |
| Real Lab Tech data accidentally written to team-owned mini-PC during or after Sprint 5 | Low        | High   | Tear-down of dev staging's Keycloak realm at end of Sprint 4; Sprint 5 onward, dev staging uses synthetic data only; ADR documents the rule                                |

---

## 19. Out of Scope (Defer to v2)

- Satellite campus locations (Aero Centre, Pt. Trotter).
- Equipment classes beyond the four listed.
- Mobile native apps (PWA covers the use case).
- Multi-tenant support for other SAIT schools.
- Predictive maintenance scheduling.
- Integration with equipment manufacturer telemetry.
- Multilingual support.
- AI features beyond voice-to-text: defect photo classification (unless Sprint 3 has slack), anomaly detection, LLM-generated summaries, voice biometric auth.
- mTLS between internal services.
- Distributed tracing.

---

## 20. Reference Standards

- Alberta OHS Code, Part 19: Powered Mobile Equipment (s.257, s.260).
- Alberta OHS Code, Part 6: Cranes, Hoists, and Lifting Devices.
- CAN/CSA B167: Safety Standard for Maintenance and Inspection of Overhead Cranes.
- CSA B335-15 / B335-25: Safety Standard for Lift Trucks.
- OWASP Top 10 (2021).
- OWASP ASVS Level 2 as a target.
- NIST SP 800-63B for authentication guidance.
- WCAG 2.1 Level AA.
- Alberta Freedom of Information and Protection of Privacy Act (FOIP).

---

## 21. First Two Weeks: Concrete Tasks (Sprint 0)

So the team is not staring at a blank repo on day one.

**Week 1 (May 18 to May 24)**

- [ ] Create Git repo (`mat-inspect`) on GitHub; branch protection, PR template, issue templates.
- [ ] Create `docker-compose.yml` with: Postgres, MinIO, Keycloak, Caddy, and empty service stubs for Core API, Media, Audit, AI.
- [ ] Each student gets the stack running locally (`docker compose up`).
- [ ] Stand up dev staging on the team-owned mini-PC: clone repo to `~/projects/mat-inspect/`, `docker compose up`, verify all stubs respond.
- [ ] Generate Caddy local CA root cert; distribute to all 5 team members; each installs on their dev devices.
- [ ] Add all 5 students to the host owner's Tailscale tailnet (project-scoped).
- [ ] Create Bitwarden shared collection for the team; seed it with placeholder entries for Keycloak admin, SMTP, database, MinIO.
- [ ] Lock framework choices: Node.js + Fastify + TypeScript (services), Next.js (PWA + dashboard), Python + FastAPI + faster-whisper (AI), Drizzle ORM, Zod validation, Tailwind + shadcn/ui.
- [ ] Write first ADRs: framework choices, Whisper variant (`small.en`), hosting target placeholder, dev staging on team-owned hardware with constraints from Section 12.7.
- [ ] CI pipeline that runs lint and a hello-world test, green on first commit.
- [ ] Configure GitHub Actions to SSH-deploy to dev staging on merge to `main`.
- [ ] Schedule Lab Tech shadowing sessions for Week 2.

**Week 2 (May 25 to May 31)**

- [ ] Run job shadow sessions with at least 4 Lab Techs across the four equipment classes.
- [ ] Document current paper checklists (photograph or transcribe all of them).
- [ ] Draft initial ChecklistTemplate JSON for each equipment class; review with sponsor before Sprint 1.
- [ ] Provision Keycloak realm; create test users for each role.
- [ ] Stub Core API `GET /api/v1/equipment` returning the 10 hard-coded machines.
- [ ] Stub AI Service `POST /api/v1/ai/transcribe` returning a hardcoded transcript for any input (real Whisper integration in Sprint 3).
- [ ] PWA renders a list of equipment from the stub API. This is the "hello world" milestone.
- [ ] First end-to-end deploy: PR merged to `main` triggers GitHub Actions, deploys to dev staging on the mini-PC, all 5 team members can see the change at the staging URL over Tailscale.
- [ ] Campus IT meeting; document hosting decision and SSO path in an ADR.
- [ ] Request FOIP review checklist from SAIT privacy office.

After Sprint 0: running stack locally and on shared dev staging, continuous deployment working, real domain knowledge gathered, end-to-end skeleton with AI stub, hosting and identity decisions made.

---

## 22. Definition of Done (for any feature)

A feature is done when:

1. Code merged to `main` via PR with at least one review.
2. Unit and integration tests cover the new behavior; CI green.
3. Trivy and Semgrep show no high or critical issues introduced.
4. OpenAPI spec updated.
5. User-facing docs updated if the feature is user-visible.
6. Deployed to staging and verified by a non-author team member.
7. Demoed to the sponsor at end-of-sprint review.

---

**End of Plan**

This document is the architectural source of truth. Significant changes are tracked as ADRs in the repository.

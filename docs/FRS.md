# Functional Requirements Specification (FRS)
## MAT-Inspect: Pre-Use Inspection System

**Version:** 1.0 | **Date:** May 18, 2026
**Companion to:** `PRD.md` (the why) and `API_REFERENCE.md` (the contracts)
**Purpose:** Defines HOW each feature works, with acceptance criteria, validation rules, and edge cases

---

## 1. AUTHENTICATION AND USER MANAGEMENT

### 1.1 User Login

**Actors:** Operator, Supervisor, Manager, Admin, Auditor
**Preconditions:** User has an active Keycloak account; account is not locked
**Main Flow:**
1. User navigates to PWA or dashboard
2. App redirects to Keycloak login page
3. User enters email and password
4. (If MFA required by role) User enters TOTP code
5. Keycloak validates credentials and issues access token (15 min) and refresh token (7 days)
6. App stores tokens; user is redirected to landing screen for their role

**Alternate Flows:**
- Invalid credentials: error message; failed attempt counter increments
- Account locked (5 failed attempts in 30 min): clear error with unlock time
- Expired certification (Operator only): login succeeds but submission of expired equipment classes is blocked downstream

**Acceptance Criteria:**
- AC-1.1.1: Successful login takes under 3 seconds end to end
- AC-1.1.2: After 5 failed attempts, account locks for 30 minutes
- AC-1.1.3: MFA is enforced for Supervisor, Manager, Admin
- AC-1.1.4: Tokens are stored in memory and httpOnly cookies; never localStorage

### 1.2 User Account Creation (Admin)

**Actor:** Admin
**Preconditions:** Admin is authenticated
**Main Flow:**
1. Admin opens user management screen
2. Admin enters: display name, email, role(s), certifications (type + expiry date)
3. Admin submits
4. System creates Keycloak user with a temporary password
5. System emails the new user with login link and temporary password
6. User logs in with temporary password and is forced to change it on first login

**Validation:**
- Email: valid format, unique in system
- Display name: 2 to 80 characters
- Role: at least one role required; valid role from enum
- Certifications: zero or more entries; each must have type from enum and expiry date in the future

**Acceptance Criteria:**
- AC-1.2.1: User cannot reuse the temporary password after first change
- AC-1.2.2: Welcome email arrives within 60 seconds of account creation
- AC-1.2.3: Audit event USER_CREATED is logged

### 1.3 Role Permissions

| Capability | Operator | Supervisor | Manager | Admin | Auditor |
|------------|:-:|:-:|:-:|:-:|:-:|
| Submit inspection | yes | yes | no | no | no |
| View own inspections | yes | yes | yes | yes | yes |
| View all inspections | no | yes (own shift) | yes | yes | yes |
| Acknowledge defect | no | yes | yes | no | no |
| Approve return-to-service | no | yes | yes | no | no |
| Manage users | no | no | no | yes | no |
| Edit checklist templates | no | no | no | yes | no |
| Export PDF report | no | yes | yes | yes | yes |
| Export CSV | no | no | yes | yes | yes |

---

## 2. EQUIPMENT MANAGEMENT

### 2.1 Equipment Registry

**Actor:** Admin
**Preconditions:** Admin authenticated
**Data Fields:**
- `assetTag` (required, format `MAT-{TYPE_CODE}-{NNN}`, unique)
- `type` (required, enum: OVERHEAD_CRANE, TRUCK, ELECTRIC_PALLET_JACK, FORKLIFT)
- `make`, `model`, `serialNumber` (required, strings)
- `location` (required, e.g., "Bay 3")
- `status` (auto-managed by state machine; initial value AWAITING_INSPECTION)
- `manufacturerSpecsUrl` (optional)

**Acceptance Criteria:**
- AC-2.1.1: Asset tag is validated against the format regex on save
- AC-2.1.2: Asset tag uniqueness is enforced at the database level
- AC-2.1.3: Equipment cannot be hard-deleted; status RETIRED is used instead
- AC-2.1.4: Audit event EQUIPMENT_CREATED or EQUIPMENT_RETIRED is logged on every change

### 2.2 QR Code Generation

**Actor:** Admin
**Preconditions:** Equipment record exists
**Main Flow:**
1. Admin clicks "Generate QR Sticker" on an equipment row
2. System generates a QR code encoding the asset tag (e.g., `MAT-FL-002`)
3. System returns a printable PDF with the QR code at 50 by 50 mm, the asset tag in human-readable text below, and a placeholder for laminated mounting

**Validation:**
- QR code payload: asset tag only; never URLs, never secrets, never user IDs
- Error correction level: H (30 percent), to survive wear on the shop floor

**Acceptance Criteria:**
- AC-2.2.1: Generated QR scans correctly from 30 cm with a phone camera in lab lighting
- AC-2.2.2: PDF prints at exactly 50 mm on a standard A4 page

### 2.3 Equipment Status State Machine

**States:**
- AWAITING_INSPECTION (initial state at shift start)
- READY (last inspection PASS or FAIL_WARNING within current shift window)
- OUT_OF_SERVICE (a BLOCKING defect is OPEN, ACKNOWLEDGED, or IN_REPAIR)
- RETIRED (permanently removed from service)

**Transitions:**

| From | To | Trigger |
|------|-----|--------|
| AWAITING_INSPECTION | READY | New Inspection submitted with result PASS or FAIL_WARNING |
| AWAITING_INSPECTION | OUT_OF_SERVICE | New Inspection submitted with result FAIL_BLOCKING |
| READY | AWAITING_INSPECTION | Shift window ends |
| READY | OUT_OF_SERVICE | Mid-shift inspection with FAIL_BLOCKING result |
| OUT_OF_SERVICE | AWAITING_INSPECTION | All blocking Defects RESOLVED + supervisor approval |
| any | RETIRED | Admin action |

**Invariants (enforced by database triggers and service-level checks):**
- Equipment status cannot be set directly via PATCH; it is computed from inspection + defect state
- Audit event EQUIPMENT_STATUS_CHANGED is written for every transition

**Acceptance Criteria:**
- AC-2.3.1: Concurrent inspection submissions are serialized; final state reflects the most recent valid submission
- AC-2.3.2: Shift window end is configurable (default: 8 hours from first inspection of the day on that equipment, or end-of-business if no inspection)

---

## 3. CHECKLIST TEMPLATES

### 3.1 Template Creation

**Actor:** Admin
**Preconditions:** Admin authenticated
**Data Fields:**
- `equipmentType` (required, enum)
- `version` (auto-incremented per equipment type)
- `items` (ordered array of ChecklistItem)
- `effectiveFrom` (required, timestamp)

**ChecklistItem fields:**
- `key` (stable string identifier, used in InspectionResponse)
- `prompt` (operator-facing question)
- `type` (BOOLEAN, BOOLEAN_PHOTO_ON_FAIL, MEASUREMENT, TEXT, SIGNATURE)
- `required` (boolean)
- `failSeverity` (BLOCKING or WARNING)
- `regulatoryReference` (optional, e.g., "OHS Part 19 s.257")

**Acceptance Criteria:**
- AC-3.1.1: Item keys are unique within a template
- AC-3.1.2: At least one item with `failSeverity = BLOCKING` is required (otherwise the template cannot fail anything)
- AC-3.1.3: Templates cannot be deleted; new versions supersede old ones
- AC-3.1.4: A template becomes active when its `effectiveFrom` time passes and `isActive = true`
- AC-3.1.5: Inspections in progress when a new template version becomes active continue using the version they started with; the template_version is recorded on the Inspection

### 3.2 Template Versioning

**Behavior:**
- Each `equipmentType` has one active version at any time
- Publishing a new version sets the previous version's `isActive = false`
- Historical versions are retained indefinitely for audit reproducibility

**Acceptance Criteria:**
- AC-3.2.1: Querying inspection history shows the exact template version used for each inspection
- AC-3.2.2: Audit event CHECKLIST_PUBLISHED is logged on every new version activation

---

## 4. INSPECTION SUBMISSION

### 4.1 Operator Submits Inspection

**Actor:** Operator
**Preconditions:** Operator authenticated, holds active certification for equipment class, equipment exists and is not RETIRED
**Main Flow:**
1. Operator scans equipment QR code (or selects from list as fallback)
2. PWA calls `GET /api/v1/equipment/:asset_tag`, retrieves equipment record
3. PWA calls `GET /api/v1/checklists/active?type=...`, retrieves active template
4. PWA renders checklist; operator works through items
5. For BOOLEAN_PHOTO_ON_FAIL: if operator answers No, photo capture is required
6. For free-text notes on a failed item: operator may tap voice dictation
7. PWA records up to 30 seconds of audio, uploads via Media Service, calls AI Service for transcription
8. Operator reviews transcript, edits if needed (`notesSource` becomes VOICE_EDITED), confirms
9. Operator taps Submit
10. PWA computes HMAC over canonical record using session key
11. PWA calls `POST /api/v1/inspections` with full payload + signature
12. Core API validates JWT, validates payload via Zod, validates HMAC, validates operator certification
13. Core API persists Inspection and InspectionResponses in a transaction
14. Core API evaluates result and triggers state machine transition
15. Core API publishes events (inspection.submitted, defect.opened if applicable) to bus
16. PWA receives response and displays result screen

**Alternate Flows:**
- Offline: PWA stores submission in IndexedDB queue; syncs when network returns
- Voice unavailable (AI Service down): notes field falls back to typed; `notesSource = TYPED`
- HMAC validation fails server-side: 400 error; client treats as a bug, prompts operator to refresh and retry once

**Validation Rules:**
- All required items must have a response
- Photo required for any BOOLEAN_PHOTO_ON_FAIL item answered No
- Operator certification must cover the equipment class
- Operator certification expiry must be in the future at submission time
- HMAC signature must match canonical record
- Each response value must match its item type:
  - BOOLEAN: must be true or false
  - MEASUREMENT: numeric, within item's min/max
  - TEXT: max 500 characters
  - SIGNATURE: matches expected canonical signature

**Acceptance Criteria:**
- AC-4.1.1: Submission round-trip is under 2 seconds on a 4G connection
- AC-4.1.2: Submission with a missing required item is rejected with field-level errors
- AC-4.1.3: An expired-certification submission returns 403 with code `CERT_EXPIRED`
- AC-4.1.4: A duplicate submission (same Idempotency-Key) returns the original result
- AC-4.1.5: Audit event INSPECTION_SUBMITTED is logged

### 4.2 Voice Dictation

**Actor:** Operator
**Preconditions:** Operator on a checklist item with notes field; AI Service reachable
**Main Flow:**
1. Operator taps the dictate button
2. PWA requests microphone access (one-time browser permission)
3. PWA starts MediaRecorder (webm/opus codec)
4. PWA displays a waveform animation and elapsed seconds counter
5. Operator stops recording (tap) or recording auto-stops at 30 seconds
6. PWA uploads audio blob to Media Service; receives `voiceClipId`
7. PWA calls `POST /api/v1/ai/transcribe` with `voiceClipId`
8. AI Service downloads clip from MinIO via presigned URL, transcribes with faster-whisper, returns text
9. PWA inserts transcript into notes field; `notesSource = VOICE_TRANSCRIBED`
10. Operator may edit (`notesSource` becomes VOICE_EDITED) or accept as-is

**Validation:**
- Audio max duration: 30 seconds
- Audio max size: 2 MB
- Accepted MIME types: audio/webm, audio/ogg, audio/wav
- Transcript max length: 1000 characters (truncated with warning if exceeded)

**Acceptance Criteria:**
- AC-4.2.1: Transcription returns within 5 seconds for a 15-second clip
- AC-4.2.2: AI Service unavailable does not block submission; UI shows "voice unavailable, type your notes"
- AC-4.2.3: Voice clip is retained 90 days, then deleted by lifecycle job; transcript retained 7 years on the Inspection record
- AC-4.2.4: Audit event VOICE_TRANSCRIBED is logged

---

## 5. DEFECT WORKFLOW

### 5.1 Defect Creation

**Trigger:** Inspection submitted with at least one BLOCKING failure
**Behavior:**
- One Defect record is created per blocking failure (multiple defects possible on one inspection)
- Defect inherits `equipmentId`, `inspectionId`, `itemKey`, `severity = BLOCKING`
- Description is auto-populated from the operator's notes on the failed item
- Photos uploaded with the inspection are linked to the Defect
- Defect status starts at OPEN
- Equipment status transitions to OUT_OF_SERVICE

**Acceptance Criteria:**
- AC-5.1.1: Audit event DEFECT_OPENED is logged
- AC-5.1.2: Email and Web Push notifications sent to all Supervisors on shift within 60 seconds
- AC-5.1.3: Digital lockout tag is displayed to the operator with Defect ID prominent

### 5.2 Supervisor Acknowledges Defect

**Actor:** Supervisor or Manager
**Preconditions:** Defect status is OPEN
**Main Flow:**
1. Supervisor opens defect inbox
2. Reviews Defect details, photos, voice transcript
3. Taps Acknowledge
4. Status transitions OPEN to ACKNOWLEDGED
5. Optionally assigns to a named qualified person for repair

**Acceptance Criteria:**
- AC-5.2.1: Status transition is auditable
- AC-5.2.2: Notification to Lab Tech who reported the defect (acknowledgement received)

### 5.3 Defect Resolution

**Actor:** Supervisor or Manager (after repair work)
**Preconditions:** Defect status is ACKNOWLEDGED or IN_REPAIR
**Main Flow:**
1. Supervisor enters resolution notes describing the repair
2. Optionally attaches post-repair photos
3. Marks Defect RESOLVED
4. Audit event DEFECT_RESOLVED is logged

**Validation:**
- Resolution notes: required, minimum 20 characters
- Cannot transition to RESOLVED if a different blocking Defect on the same equipment is still open

### 5.4 Return-to-Service Approval

**Actor:** Supervisor or Manager
**Preconditions:** All blocking Defects on the equipment are RESOLVED
**Main Flow:**
1. Supervisor opens equipment record
2. Reviews resolution notes for each Defect
3. Taps "Approve Return to Service"
4. Equipment transitions OUT_OF_SERVICE to AWAITING_INSPECTION
5. A fresh inspection is still required before transition to READY

**Acceptance Criteria:**
- AC-5.4.1: Return-to-service approval is a distinct, explicit action; not implied by Defect resolution
- AC-5.4.2: Audit event RETURN_TO_SERVICE_APPROVED is logged with the approver's user ID

---

## 6. MANAGER DASHBOARD

### 6.1 Compliance Grid

**Actor:** Supervisor, Manager, Admin, Auditor
**Default View:** Today's compliance status across all equipment
**Columns:**
- Asset tag, equipment type, location
- Last inspection time
- Last inspection operator (display name)
- Last result (PASS, FAIL_WARNING, FAIL_BLOCKING)
- Current status (READY, AWAITING_INSPECTION, OUT_OF_SERVICE)
- Open defect count

**Filters:**
- Date range (last 24 hours, last 7 days, last 30 days, custom)
- Equipment type
- Location
- Operator
- Result type

**Acceptance Criteria:**
- AC-6.1.1: Initial dashboard load under 1.5 seconds
- AC-6.1.2: Filter changes update results under 500 ms
- AC-6.1.3: Real-time updates: new inspection submissions appear within 5 seconds via polling (no websocket in MVP)

### 6.2 Equipment Drilldown

**Trigger:** Click equipment row in compliance grid
**Display:**
- Equipment metadata
- Inspection history (paginated, most recent first)
- For each inspection: operator, time, result, all responses with values, photos, voice clip playback with transcript
- Defect history with status and resolution notes
- Status change timeline

**Acceptance Criteria:**
- AC-6.2.1: Inspections are paginated at 20 per page
- AC-6.2.2: Photos load lazily; voice clips are played via on-demand fetch (not pre-loaded)

---

## 7. AUDIT AND REPORTING

### 7.1 PDF Report Export

**Actor:** Supervisor, Manager, Admin, Auditor
**Main Flow:**
1. User selects filters (equipment, date range, etc.) in the dashboard
2. User clicks "Export PDF"
3. App calls `POST /api/v1/reports/export` with filter parameters; returns `jobId`
4. App polls `GET /api/v1/reports/:jobId` every 2 seconds
5. Audit/Report Service queries Postgres, fetches photos and audit chain segments
6. Generates PDF with embedded photos, signatures (operator name + timestamp), audit chain segment, system version
7. Signs the PDF using the system's signing key
8. Uploads PDF to MinIO; returns presigned URL when job completes
9. App displays download link

**PDF Contents:**
- Cover page: filter summary, generation timestamp, generated-by user, system version
- For each inspection: equipment metadata, all responses, photo thumbnails, voice transcripts, HMAC signature
- Audit chain segment: prev_hash and this_hash for each event in the export range
- Appendix: instructions to independently verify the hash chain

**Acceptance Criteria:**
- AC-7.1.1: Single-inspection PDF generation under 3 seconds
- AC-7.1.2: 100-inspection PDF under 30 seconds
- AC-7.1.3: PDF is digitally signed (PDF signature dictionary using project signing key)
- AC-7.1.4: Audit event REPORT_EXPORTED is logged with the requesting user ID and filter parameters

### 7.2 CSV Export

**Actor:** Manager, Admin, Auditor
**Behavior:** Same filter selection as PDF; produces a flat CSV with one row per InspectionResponse
**Columns:** inspection_id, equipment_asset_tag, equipment_type, operator_id, operator_name, submitted_at, result, item_key, item_prompt, response_value, passed, notes, notes_source, defect_id (if any)

**Acceptance Criteria:**
- AC-7.2.1: CSV under 10 MB for any plausible date range
- AC-7.2.2: UTF-8 encoded with BOM (Excel-compatible)

### 7.3 Hash Chain Verification

**Actor:** Audit/Report Service (on startup) and Auditor (manual)
**Behavior:**
- On service startup, verify the last 1000 events in the audit chain
- On export, include enough chain context that the export is independently verifiable
- Verification: recompute SHA-256 over (event canonical form + prev_hash); compare to stored this_hash

**Acceptance Criteria:**
- AC-7.3.1: Startup verification logs PASS or FAIL with the broken event ID
- AC-7.3.2: Chain break triggers critical alert to Admin
- AC-7.3.3: A separate CLI tool is provided so auditors can re-verify from a PDF export

---

## 8. NOTIFICATIONS

### 8.1 Email Notifications

See `PRD.md` Section 9 for the complete trigger list.

**Behavior:**
- All emails sent via SMTP relay
- Failures are retried up to 3 times with exponential backoff
- Persistent failures logged as critical alerts
- Email templates live in `services/core-api/templates/emails/` as Handlebars files

**Acceptance Criteria:**
- AC-8.1.1: Email delivery within 60 seconds for non-batched triggers
- AC-8.1.2: Templates are reviewable by the team (no opaque external service)
- AC-8.1.3: Subject lines never contain PII (use generic patterns: "MAT-Inspect: New defect on equipment XXX")

### 8.2 Web Push Notifications

**Behavior:**
- Supervisors and Managers may subscribe via the PWA
- Used for time-sensitive alerts (failed inspection)
- Subscription stored in Postgres; sent via Web Push protocol (VAPID keys)

**Acceptance Criteria:**
- AC-8.2.1: Subscription is opt-in
- AC-8.2.2: Notification appears on lock screen and home screen on iOS 16+ and Android 12+

---

## 9. OFFLINE OPERATION (PWA)

### 9.1 Offline Submission Queue

**Trigger:** PWA detects network failure during submission
**Behavior:**
- PWA stores the full Inspection payload (with audio, photos as blobs) in IndexedDB
- Background sync attempts every 30 seconds
- On reconnection, submissions are uploaded in chronological order
- Operator is shown a clear "queued offline" indicator

**Validation:**
- HMAC signature is computed before queueing (uses the session key at submission time, not sync time)
- If the operator's session has expired by sync time, the submission still succeeds because the HMAC was signed when the session was valid
- Server validates HMAC against the session that was active at `started_at`

**Acceptance Criteria:**
- AC-9.1.1: Up to 10 inspections can be queued before storage limits
- AC-9.1.2: Queue survives PWA close and reopen
- AC-9.1.3: Queued submissions display in operator history with "pending sync" badge

### 9.2 Offline Checklist Cache

**Behavior:**
- Active checklist templates are cached locally on first load
- Service worker refreshes cache when network is available
- Cache invalidation: TTL of 24 hours, or explicit force-refresh on demand

**Acceptance Criteria:**
- AC-9.2.1: Checklist for any of the 10 equipment items loads from cache when offline
- AC-9.2.2: Operator is warned when using cached templates older than 7 days (rare but possible if device offline for a week)

---

## 10. ADMIN: CHECKLIST EDITOR

### 10.1 Template Edit UI

**Actor:** Admin
**Main Flow:**
1. Admin opens template editor
2. Selects equipment type
3. Sees current version's items in an ordered list
4. Adds new item, edits prompt or validation, reorders, marks items as removed
5. Previews the template as it will appear in the PWA
6. Saves as a new version
7. Sets `effectiveFrom` (immediate or scheduled)
8. Confirms; new version becomes active at `effectiveFrom`

**Validation:**
- Cannot remove the last BLOCKING item (template must have at least one blocking failure path)
- Cannot change an item's `key` once published in a previous version (would break audit history); deprecate and add new key instead
- `effectiveFrom` cannot be in the past (use immediate activation if needed)

**Acceptance Criteria:**
- AC-10.1.1: Preview reflects exactly what the operator sees
- AC-10.1.2: New version does not affect inspections in progress
- AC-10.1.3: Diff view shows changes from previous version

---

## 11. DATA RETENTION AND DELETION

### 11.1 Retention Policy

| Data Type | Retention | Enforcement |
|-----------|-----------|-------------|
| Inspection records | 7 years from `submittedAt` | Lifecycle job tags records for review; no automatic deletion in MVP |
| Audit events | 7 years from event time | Never auto-deleted; legal-hold flag prevents deletion if set |
| Voice audio clips | 90 days from creation | Lifecycle job deletes from MinIO; transcripts remain on Inspection |
| Photos | 7 years from upload | Tied to Inspection retention |
| User accounts (soft-deleted) | Indefinite (audit integrity) | Hard delete only on documented legal request |
| Backups | 30 days local, 1 year off-site | Backup retention policy on storage target |

### 11.2 Right to Data Access (FOIP)

**Actor:** Any authenticated user
**Main Flow:**
1. User opens profile, taps "Export my data"
2. System generates a ZIP containing: account record, all inspections, all photos and voice clips associated with their submissions
3. ZIP is delivered via download link (presigned URL, valid 24 hours)
4. Audit event USER_DATA_EXPORTED is logged

**Acceptance Criteria:**
- AC-11.2.1: Export completes within 5 minutes for any user
- AC-11.2.2: Other users' data is never included, even if cross-referenced

### 11.3 Right to Erasure (FOIP)

**Actor:** Admin (after legal review)
**Behavior:**
- Soft delete: user account marked inactive; inspections preserved with user ID intact (legally required for audit)
- Hard delete: only on documented legal request; user record replaced with anonymized placeholder; audit event records the deletion reason and the requesting authority

---

## 12. ERROR HANDLING AND USER MESSAGING

### 12.1 Error Categories

| Category | User-Facing Message Style | Examples |
|----------|---------------------------|----------|
| Validation | Field-level inline errors | "Required field", "Number must be 0 to 100" |
| Authentication | Top-level banner | "Session expired, please log in again" |
| Authorization | Top-level banner with reason | "Your forklift certification expired on 2026-04-12" |
| Network | Subtle inline indicator | "Saving offline, will sync when reconnected" |
| Server error | Apology with retry button | "Something went wrong on our end, please try again. If this continues, contact your supervisor." |
| Conflict | Specific guidance | "This equipment is currently OUT_OF_SERVICE. Defect DEF-2026-014 must be resolved first." |

### 12.2 Error Response Format

All API errors follow RFC 7807 (`application/problem+json`):

```json
{
  "type": "https://mat-inspect.example.com/errors/cert-expired",
  "title": "Certification expired",
  "status": 403,
  "detail": "Your forklift certification expired on 2026-04-12.",
  "instance": "/api/v1/inspections",
  "code": "CERT_EXPIRED",
  "certificationType": "FORKLIFT",
  "expiredAt": "2026-04-12T00:00:00Z"
}
```

The `code` field is a stable string used by the PWA for localized message lookup.

---

## 13. EDGE CASES AND CONSIDERATIONS

### 13.1 Concurrent Inspections on Same Equipment

If two operators submit inspections for the same equipment within seconds of each other:
- Both submissions are accepted (both are legitimate inspections)
- The most recent submission determines equipment status (last write wins on status, but all records are preserved)
- Both submissions appear in equipment history

### 13.2 Operator Loses Phone Mid-Inspection

If PWA crashes or phone dies during an inspection:
- Partial state is preserved in IndexedDB for 24 hours
- On next login, operator is offered to resume the in-progress inspection
- If not resumed within 24 hours, partial state is discarded

### 13.3 Shift Window Boundary

If an operator starts an inspection at 4:55 PM but submits at 5:01 PM (after shift end):
- Inspection is accepted; `submittedAt` records the actual submission time
- The inspection is associated with the shift that was active at `startedAt`
- Equipment status update applies to the shift in which the inspection was submitted

### 13.4 Daylight Saving Time

All timestamps are stored in UTC. UI displays in user's local timezone (Mountain Time for SAIT). DST transitions do not affect shift window logic; shift windows are defined in UTC offsets.

### 13.5 Network Partial Failure During Submission

If photo upload succeeds but the Inspection POST fails:
- PWA retries Inspection POST up to 3 times
- After 3 failures, photos remain in MinIO (orphaned, cleaned by daily job)
- Operator sees "submission failed, please retry"
- On retry, the same photo IDs are referenced (no duplicate upload)

### 13.6 Voice Transcription with Background Noise

If transcription confidence is below 0.5, the AI Service still returns the transcript but adds a `lowConfidence: true` flag.
- PWA displays a warning and recommends the operator review carefully
- Operator must explicitly confirm low-confidence transcripts before submission

---

*See `API_REFERENCE.md` for endpoint contracts. See `ARCHITECTURE.md` for system design. See `CODING_STANDARDS.md` for implementation conventions.*

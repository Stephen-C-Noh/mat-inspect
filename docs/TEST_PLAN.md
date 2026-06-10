# Test Plan: MAT-Inspect

**Version:** 1.0 | **Date:** May 26, 2026
**Standard:** IEEE 829 (adapted)
**Companion documents:** `FRS.md`, `ARCHITECTURE.md`, `software_testing_guideline.md`

---

## Phase 1: Testing Strategy

### 1. Development Risk Analysis

The primary risk is a defect that undermines regulatory compliance. Alberta OHS s.257 requires an authorized operator to complete a visual inspection before equipment operation. A bug that allows equipment to reach READY status without a valid attested inspection, or that allows inspection records to be modified after submission, creates legal liability for SAIT and safety risk for Lab Techs.

Secondary risks, ranked by severity:

| Risk                                             | Source                              | Reducible by Testing                       |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------ |
| Equipment reaches READY without valid inspection | State machine defect                | Yes: integration tests on every transition |
| Audit chain corrupted or forgeable               | Hash chaining bug                   | Yes: dedicated chain integrity tests       |
| Unauthorized role access to protected endpoints  | Auth middleware defect              | Yes: role-boundary tests per endpoint      |
| Voice clip sent to external service              | AI Service integration defect       | Yes: network isolation test                |
| Operator certification bypass                    | Validation defect                   | Yes: negative test cases on cert expiry    |
| Data loss on submission retry                    | Race condition in idempotency logic | Yes: concurrent submission tests           |
| PDF report unsigned or hash mismatch             | Crypto bug in Audit Service         | Yes: integration tests on report export    |

### 2. Test Completion Criterion

Testing is complete when all of the following are true:

- All 59 test cases in Section 10 have been executed and results recorded.
- Pass rate is 95% or higher (no more than 3 test cases failing).
- All BLOCKING severity defects are resolved.
- No HIGH or CRITICAL findings remain from Trivy, Semgrep, or Gitleaks.
- The audit chain verification passes on a clean startup in the dev staging environment.
- The DR rehearsal (Section 8, Sprint 4) completes within the documented time target.

### 3. Test Management

**Owner:** The DevOps/QA team member is responsible for writing test cases, tracking execution, and maintaining the defect log.

**Roles:**

| Role                   | Responsibility                                                     |
| ---------------------- | ------------------------------------------------------------------ |
| DevOps/QA              | Write cases, run execution, track defect log, report daily results |
| All backend developers | Write unit and integration tests for their own services            |
| Frontend developer     | Write unit tests for PWA; participate in simulated pilot           |
| Team lead              | Triage blocking defects; sign off on test completion criterion     |
| Sponsor                | Attend Sprint 5 simulated pilot; provide acceptance sign-off       |

**Escalation:** A BLOCKING defect discovered after Sprint 4 is escalated to the team lead same-day. If not resolved within 2 days, it is flagged to the sponsor.

**Sign-off:** Two sign-offs are required before handover: team lead approval that the completion criterion is met, and sponsor approval after the Sprint 5 simulated pilot.

### 4. Timing for ROI

Earlier defect detection is cheaper. The testing effort is distributed across sprints to find defects at the phase where they are cheapest to fix.

| Phase                            | When               | Defect cost if found here      |
| -------------------------------- | ------------------ | ------------------------------ |
| Static (code review, linting)    | Every PR           | Minutes to fix                 |
| Unit (Vitest, pytest)            | Every PR, CI-gated | Hours to fix                   |
| Integration (testcontainers)     | Every PR, CI-gated | Hours to fix                   |
| System (dev staging, full stack) | Sprints 4 and 5    | Days to fix                    |
| Simulated pilot (Sprint 5)       | Week 11            | Days to fix; may slip timeline |
| Post-handover                    | After August 15    | Weeks; SAIT IT involved        |

### 5. Cost of Failure Estimate

| Failure type                                                        | Estimated cost                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| OHS non-compliance (failed audit due to missing records)            | Regulatory fines; potential stop-work order on MAT lab equipment              |
| Equipment operated in OUT_OF_SERVICE state due to state machine bug | Injury liability; equipment damage                                            |
| Audit chain break that voids legal record value                     | 7 years of records become inadmissible; repeat paper-based recording required |
| FOIP breach (voice or photo data leaves SAIT infrastructure)        | Institutional liability; reporting obligation under FOIP                      |
| System unavailable at shift start                                   | All 10 pieces of equipment cannot be inspected digitally; fallback to paper   |

### 6. Risk Reduction Tactics

**Positive testing:** confirm each acceptance criterion in `FRS.md` is met by the happy-path test cases in Section 10.

**Negative testing:** for each validation rule and access control boundary, test that invalid input is rejected and unauthorized access returns 403. Negative cases account for approximately one third of the test case set.

**Risk prioritization matrix:**

| Severity | Likelihood | Priority                    |
| -------- | ---------- | --------------------------- |
| HIGH     | HIGH       | P1: block release           |
| HIGH     | LOW        | P2: fix before Sprint 5     |
| LOW      | HIGH       | P3: fix before handover     |
| LOW      | LOW        | P4: log, fix if time allows |

**Defect arrival tracking:** the DevOps/QA member records the number of new defects found per testing day. A flattening curve in the second half of Sprint 4 is the primary evidence that the system is approaching stability.

**Customer usage analysis:** SAIT Lab Techs perform inspections at shift start (roughly 07:00 and 13:00 Mountain Time). Inspection volume is low: 10 pieces of equipment, 2 shifts per day. The system is designed for bursty single-user sessions, not high concurrency. Testing does not require load simulation beyond 5 concurrent users.

### 7. Selected Testing Types

| Type                    | Method                                      | When               |
| ----------------------- | ------------------------------------------- | ------------------ |
| Static                  | ESLint, Ruff, Semgrep, manual code review   | Every PR           |
| White-box (unit)        | Vitest (TypeScript), pytest (Python)        | Every PR, CI-gated |
| White-box (integration) | testcontainers (Postgres + Azurite)         | Every PR, CI-gated |
| Black-box (system)      | Manual test cases against dev staging       | Sprints 4 and 5    |
| Black-box (UAT)         | Simulated pilot with sponsor                | Sprint 5           |
| Security                | Trivy, Semgrep, Gitleaks, internal pen test | Sprint 4           |
| Performance             | Manual timing against acceptance criteria   | Sprint 5           |

---

## Phase 2: Test Plan (IEEE 829)

### Part A: Overall Test Plan

#### 1. System Under Test

MAT-Inspect is a digital pre-use inspection system for 10 pieces of high-risk equipment at SAIT Main Campus (4 overhead cranes, 2 trucks, 1 electric pallet jack, 3 forklifts).

The system under test consists of:

- **PWA** (`apps/pwa`): mobile web app used by Operators to complete inspections
- **Dashboard** (`apps/dashboard`): desktop web app used by Managers and Supervisors
- **Core API** (`services/core-api`): business logic, inspection submission, defect workflow
- **Media Service** (`services/media`): photo and voice clip upload via Azure Blob Storage (Azurite in tests)
- **Audit/Report Service** (`services/audit`): hash-chained audit log, PDF export, CSV export
- **AI Service** (`services/ai`): voice transcription via faster-whisper
- **Infrastructure**: Caddy, PostgreSQL 16, Azurite, Entra ID (team-owned tenant)

#### 2. Testing Objectives

Objectives are listed in order of business risk.

1. Confirm that no path exists that allows equipment to reach READY status without a valid, attested inspection from an authorized operator dated the current calendar day, lab-local, and performed after the most recent return-to-service. (OHS s.257; ADR 0006, ADR 0007)
2. Confirm that inspection records cannot be modified or deleted after submission.
3. Confirm that the audit chain is tamper-evident: any inserted, modified, or deleted event is detected on verification.
4. Confirm that voice clips and photos do not leave SAIT-controlled infrastructure.
5. Confirm that role-based access control is enforced on every API endpoint.
6. Confirm that the defect-to-return-to-service workflow operates correctly and requires supervisor approval.
7. Confirm that the system meets the performance acceptance criteria in `FRS.md`.
8. Confirm that the PWA is tolerant of short network drops during submission.

#### 3. Scope and Limitations

**In scope:**

- All features defined in `FRS.md` Sections 1 through 11
- All 5 user roles: Operator, Supervisor, Manager, Admin, Auditor
- All 4 equipment types: OVERHEAD_CRANE, TRUCK, ELECTRIC_PALLET_JACK, FORKLIFT
- API endpoints defined in `API_REFERENCE.md`
- CI pipeline gates (lint, type check, unit tests, integration tests, security scans)
- Dev staging environment on the team-owned mini-PC

**Out of scope:**

- Real SAIT Lab Techs as test participants (FOIP: not permitted on team-owned hardware)
- Load testing beyond 5 concurrent users (usage volume does not warrant it)
- SAIT Entra ID tenant (only available post-handover)
- Mobile device compatibility beyond Chrome on Android and Safari on iOS 16+
- Third-party SMTP delivery SLA (outside team control)

**Known constraints:**

- The dev staging environment runs on a single mini-PC. Redundancy and failover testing is not possible until SAIT IT provisions their infrastructure.
- The simulated pilot uses synthetic data only. Acceptance is simulated; real Lab Tech sign-off happens post-handover.

#### 4. Sources of Business Expertise

| Source                                        | Domain                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| SAIT School of MAT sponsor                    | Equipment types, shift patterns, defect severity conventions |
| Alberta OHS Code (search-ohs-laws.alberta.ca) | Regulatory requirements for inspection records               |
| CSA B167, CSA B335 standards                  | Operator competency and crane/forklift-specific rules        |
| `FRS.md` acceptance criteria                  | The team's documented interpretation of all of the above     |

#### 5. Sources of Development Expertise

| Source                  | Domain                                                   |
| ----------------------- | -------------------------------------------------------- |
| Team backend developers | Core API, Audit Service, Media Service business logic    |
| Team frontend developer | PWA and Dashboard behaviour                              |
| DevOps/QA team member   | CI pipeline, staging environment, integration test setup |
| `ARCHITECTURE.md`       | Authoritative reference for system design decisions      |
| `CODING_STANDARDS.md`   | Code review baseline                                     |

#### 6. Sources of Test Data

| Data type                      | Source                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Equipment records              | `db/seed.ts` synthetic seed script (all 10 pieces of equipment)                     |
| User accounts with all 5 roles | Entra ID test users defined in Sprint 0                                             |
| Checklist templates            | Seed script; covers all 4 equipment types with at least one BLOCKING item each      |
| Inspection responses           | Manually crafted for each test case; PASS, FAIL_WARNING, and FAIL_BLOCKING variants |
| Voice clips                    | 10 to 15 second test clips recorded in the MAT lab during Sprint 0 acoustic test    |
| Photos                         | Stock images used as defect photo placeholders                                      |

Production data is never used in the test environment. The seed script is the sole source of realistic test data.

#### 7. Test Environment Requirements

| Component      | Specification                                                                    |
| -------------- | -------------------------------------------------------------------------------- |
| Host           | Team-owned mini-PC running Docker Compose dev stack                              |
| Network access | Tailscale VPN; team members connect remotely                                     |
| TLS            | Caddy local CA in dev mode; all team browsers trust the local CA certificate     |
| Database       | PostgreSQL 16 container; separate `core_db` and `audit_db` schemas               |
| Object storage | Azurite container; `inspections` and `reports` blob containers pre-created       |
| Auth           | Team-owned Entra ID Free tenant; 5 test users, one per role                      |
| AI Service     | faster-whisper `small.en` model loaded; CPU inference acceptable for test volume |
| Observability  | Prometheus, Grafana, Loki running; dashboards configured                         |
| CI             | GitHub Actions; all pipeline stages run on every PR                              |

**Environment reset procedure:** Before each test session, run `docker compose down -v && docker compose up -d` and execute `npm run db:seed` to return to a known state.

---

### Part B: Detailed Test Execution Instructions

#### 8. Testing Details per Development Phase

---

**Unit Testing (all sprints)**

- Development phase: unit
- Entry criteria: feature code is written and committed to a PR branch
- Exit criteria: CI green; 70% line coverage on files in `services/*/src/use-cases/`, `services/*/src/domain/`, and `packages/*/src/`
- Test case list: automated; see `*.test.ts` and `test_*.py` files alongside source
- Writing schedule: written by the developer who writes the feature, in the same PR
- Execution schedule: every PR push; CI runs automatically
- Results analysis: CI pass/fail is the result; failures block merge

---

**Integration Testing (Sprints 1 through 4)**

- Development phase: integration
- Entry criteria: at least one service is deployable via Docker Compose; Postgres and Azurite containers start cleanly
- Exit criteria: CI green; all testcontainer-based integration tests pass; no test skips without documented reason
- Test case list: automated; live alongside source in `*.integration.test.ts` files
- Writing schedule: written alongside the feature that requires cross-service validation
- Execution schedule: every PR push; CI runs automatically
- Results analysis: CI pass/fail; failures block merge

---

**System Testing (Sprint 4, weeks 9 to 10, July 13 to July 26)**

- Development phase: system
- Entry criteria: all services are running on dev staging; seed data loaded; all five Entra ID test users can log in; CI is green on `main`
- Exit criteria: all manual test cases in Section 10 executed; pass rate 95% or higher; all P1 defects resolved
- Test case list: Section 10 of this document (59 cases)
- Writing schedule: test cases written by end of Sprint 3 (July 12)
- Execution schedule: July 13 to July 21 (first pass); July 22 to July 26 (retest of failed cases and regression)
- Results analysis: daily outcome log updated by DevOps/QA; defect tracking spreadsheet updated same day as finding; results reviewed with team at daily standup

---

**Security Testing (Sprint 4, July 13 to July 26)**

- Development phase: security
- Entry criteria: system testing has begun; all services running on dev staging
- Exit criteria: Trivy, Semgrep, Gitleaks all pass with zero HIGH or CRITICAL findings; internal pen test completed and all P1 findings resolved
- Test case list: TC-SEC-001 through TC-SEC-005 in Section 10; automated scanner output
- Writing schedule: automated scans run in CI continuously; pen test plan drafted by July 13
- Execution schedule: automated scans continuous; manual pen test July 21 to July 23
- Results analysis: scanner output reviewed daily; pen test findings triaged same day

---

**Simulated Pilot / UAT (Sprint 5, week 11, July 27 to August 2)**

- Development phase: UAT
- Entry criteria: system testing complete; pass rate criterion met; sponsor confirmed for attendance; seed data loaded covering all 10 pieces of equipment
- Exit criteria: sponsor observes and accepts all operator, supervisor, and manager flows end to end; no new P1 defects introduced; sponsor provides verbal sign-off
- Test case list: full Section 10 re-execution as a walkthrough; sponsor observes key flows
- Writing schedule: no new test cases; same 59 cases re-executed
- Execution schedule: July 27 to August 1; sponsor walkthrough session July 28 or 29
- Results analysis: defects found during pilot have same-day triage; critical fixes turned around within 2 days

---

#### 9. Overall Testing Schedule

| Activity                                              | Sprint      | Dates                  |
| ----------------------------------------------------- | ----------- | ---------------------- |
| Unit and integration tests written alongside features | 1 through 4 | June 8 to July 26      |
| System test cases written (Section 10)                | 3           | By July 12             |
| System test execution, first pass                     | 4           | July 13 to July 21     |
| Security scans and internal pen test                  | 4           | July 21 to July 23     |
| Defect retest and regression                          | 4           | July 22 to July 26     |
| DR rehearsal                                          | 4           | July 24 to July 25     |
| Simulated pilot (UAT)                                 | 5           | July 27 to August 2    |
| Bug fixes from pilot                                  | 6           | August 3 to August 9   |
| Final smoke test before handover                      | 6           | August 12 to August 14 |

---

#### 10. Test Case Set

Each test case follows this format: ID, title, preconditions, steps, expected result, severity if failed.

Severity codes: **BLOCKING** (release cannot proceed), **HIGH** (must fix before UAT), **MEDIUM** (fix before handover), **LOW** (log, fix if time allows).

---

##### Authentication and Authorization

**TC-AUTH-001: Operator logs in successfully via Entra ID**

- Preconditions: Operator test user exists in team Entra ID tenant; browser has no cached session
- Steps: Navigate to PWA URL; observe redirect to Microsoft login; enter Operator credentials; complete login
- Expected result: Operator is redirected to the inspection landing screen; no dashboard link visible
- Failure severity: BLOCKING

**TC-AUTH-002: Manager logs in and sees dashboard**

- Preconditions: Manager test user exists; browser has no cached session
- Steps: Navigate to dashboard URL; complete login with Manager credentials
- Expected result: Manager sees the compliance grid with all equipment; no "Submit Inspection" option visible
- Failure severity: BLOCKING

**TC-AUTH-003: Invalid credentials show error**

- Preconditions: None
- Steps: Navigate to PWA; attempt login with a nonexistent email
- Expected result: Microsoft login page shows an error; user is not redirected into the app
- Failure severity: HIGH

**TC-AUTH-004: Account locks after 5 failed login attempts**

- Preconditions: A test user account with known credentials
- Steps: Enter wrong password 5 times in 30 minutes on the Microsoft login screen
- Expected result: Microsoft shows account lockout message with unlock time (30 minutes); sixth attempt is blocked without checking password
- Failure severity: HIGH

**TC-AUTH-005: MFA is enforced for Supervisor role**

- Preconditions: Supervisor test user configured with MFA in Entra ID
- Steps: Log in as Supervisor; proceed through password entry
- Expected result: Microsoft Authenticator or TOTP prompt appears before session is issued
- Failure severity: HIGH

**TC-AUTH-006: MFA is enforced for Manager role**

- Preconditions: Manager test user configured with MFA in Entra ID
- Steps: Log in as Manager; proceed through password entry
- Expected result: MFA prompt appears; login does not complete without second factor
- Failure severity: HIGH

**TC-AUTH-007: Operator with expired certification cannot submit for that equipment class**

- Preconditions: Operator user with FORKLIFT certification set to expired date (yesterday); a FORKLIFT equipment record exists
- Steps: Log in as that Operator; scan FORKLIFT QR code; complete checklist; tap Submit
- Expected result: API returns 403 with code `CERT_EXPIRED`; PWA shows certification expiry message; submission is not recorded
- Failure severity: BLOCKING

**TC-AUTH-008: Tokens are not stored in localStorage**

- Preconditions: Logged-in Operator session in PWA
- Steps: Open browser DevTools; inspect `localStorage`; inspect `sessionStorage`
- Expected result: No JWT or refresh token found in either storage; tokens are in httpOnly cookies only
- Failure severity: BLOCKING

**TC-AUTH-009: Expired access token triggers silent refresh**

- Preconditions: Operator is logged in; access token is close to expiry (manipulate system clock or wait)
- Steps: With a nearly-expired token, submit a valid inspection
- Expected result: Submission succeeds; new access token is issued via refresh token; operator does not see a login prompt
- Failure severity: HIGH

**TC-AUTH-010: Operator cannot access Manager dashboard routes**

- Preconditions: Operator is logged in
- Steps: Manually navigate to the dashboard URL; attempt to call `GET /api/v1/reports` with the Operator JWT
- Expected result: Dashboard returns 403 or redirects to login; API returns 403
- Failure severity: BLOCKING

---

##### Equipment Management

**TC-EQUIP-001: Admin registers new equipment**

- Preconditions: Admin is logged in
- Steps: Open user management; fill in all required fields with a valid asset tag (`MAT-FL-004`); submit
- Expected result: Equipment appears in the registry; status is AWAITING_INSPECTION; audit event EQUIPMENT_CREATED is in the audit log
- Failure severity: HIGH

**TC-EQUIP-002: Asset tag format validation rejects invalid formats**

- Preconditions: Admin is logged in; equipment creation form is open
- Steps: Submit equipment with asset tag `FL004` (missing prefix and hyphens)
- Expected result: Validation error returned before database write; equipment is not created
- Failure severity: HIGH

**TC-EQUIP-003: Duplicate asset tag is rejected**

- Preconditions: Equipment `MAT-FL-001` already exists in the database
- Steps: Admin attempts to create a second equipment record with asset tag `MAT-FL-001`
- Expected result: API returns 409 or validation error; database unique constraint prevents the insert
- Failure severity: HIGH

**TC-EQUIP-004: Equipment cannot be hard-deleted**

- Preconditions: Admin is logged in; `MAT-FL-001` exists
- Steps: Attempt to call `DELETE /api/v1/equipment/MAT-FL-001` directly
- Expected result: 404 or 405 (endpoint does not exist); no record is removed from the database
- Failure severity: BLOCKING

**TC-EQUIP-005: QR code payload contains only the asset tag**

- Preconditions: Admin is logged in; `MAT-FL-001` exists
- Steps: Generate QR sticker PDF for `MAT-FL-001`; decode the QR code with a reader
- Expected result: Decoded payload is exactly the string `MAT-FL-001`; no URL, no user ID, no secret
- Failure severity: HIGH

**TC-EQUIP-006: Generated QR code scans at 30 cm in lab lighting**

- Preconditions: QR sticker PDF generated for `MAT-FL-001`; printed on A4 paper
- Steps: Hold a phone camera 30 cm from the printed QR code in the MAT lab with typical overhead lighting
- Expected result: QR code is read correctly within 3 seconds; PWA navigates to the correct equipment checklist
- Failure severity: HIGH

**TC-EQUIP-007: Equipment cannot reach READY without a passing inspection**

- Preconditions: `MAT-FL-001` is in AWAITING_INSPECTION state
- Steps: Attempt to set equipment status to READY via a direct PATCH request to the API
- Expected result: 400 or 405; equipment status is not changed; status transitions are only triggered by inspection submission
- Failure severity: BLOCKING

**TC-EQUIP-008: FAIL_BLOCKING inspection sets equipment to OUT_OF_SERVICE**

- Preconditions: `MAT-FL-001` is in AWAITING_INSPECTION; a checklist template with a BLOCKING item exists
- Steps: Submit an inspection where the BLOCKING item fails; observe equipment status
- Expected result: Equipment status transitions to OUT_OF_SERVICE; audit event EQUIPMENT_STATUS_CHANGED is logged; digital lockout message is shown to operator
- Failure severity: BLOCKING

**TC-EQUIP-009: Return-to-service requires all defects resolved and supervisor approval**

- Preconditions: `MAT-FL-001` is OUT_OF_SERVICE with one open blocking defect
- Steps: Attempt to call "Approve Return to Service" while the defect is still OPEN
- Expected result: Action is rejected; equipment remains OUT_OF_SERVICE; only after all defects are RESOLVED can the approval action proceed
- Failure severity: BLOCKING

**TC-EQUIP-010: Status change is logged in the audit trail**

- Preconditions: `MAT-FL-001` is in AWAITING_INSPECTION
- Steps: Submit a passing inspection; check the audit log
- Expected result: Audit event EQUIPMENT_STATUS_CHANGED with `from: AWAITING_INSPECTION`, `to: READY`, and the operator ID is present in `audit_db`
- Failure severity: BLOCKING

---

##### Checklist Templates

**TC-TMPL-001: Admin creates a new checklist template**

- Preconditions: Admin is logged in; no active FORKLIFT template exists for the current version
- Steps: Open checklist editor; select FORKLIFT; add items including one with `failSeverity = BLOCKING`; set effectiveFrom to immediate; save
- Expected result: Template is created; version number is incremented; template becomes active; audit event CHECKLIST_PUBLISHED is logged
- Failure severity: HIGH

**TC-TMPL-002: Template item keys must be unique within a template**

- Preconditions: Admin is in the checklist editor
- Steps: Attempt to add two items with the same key (e.g., `fork-tines-condition`)
- Expected result: Validation error; template cannot be saved with duplicate keys
- Failure severity: HIGH

**TC-TMPL-003: Template must have at least one BLOCKING item**

- Preconditions: Admin is in the checklist editor
- Steps: Create a template with only WARNING-severity items; attempt to save
- Expected result: Validation error: "At least one BLOCKING item is required"; template is not saved
- Failure severity: BLOCKING

**TC-TMPL-004: Templates cannot be deleted**

- Preconditions: A checklist template exists
- Steps: Attempt to DELETE the template via the API
- Expected result: 404 or 405; template record remains in the database; only new versions can supersede it
- Failure severity: BLOCKING

**TC-TMPL-005: Active inspections use the template version they started with**

- Preconditions: Operator has started a FORKLIFT inspection on template version 2; Admin publishes template version 3 before the operator submits
- Steps: Operator completes and submits the inspection
- Expected result: Submission is accepted; `template_version` field on the Inspection record is 2, not 3
- Failure severity: HIGH

---

##### Inspection Submission

**TC-INSP-001: Operator submits a passing inspection**

- Preconditions: Operator logged in with valid FORKLIFT certification; `MAT-FL-001` in AWAITING_INSPECTION; active checklist template exists
- Steps: Scan QR code; complete all checklist items with passing responses; submit
- Expected result: Submission accepted (201); equipment status becomes READY; PWA shows pass confirmation; audit event INSPECTION_SUBMITTED logged
- Failure severity: BLOCKING

**TC-INSP-002: Submission with missing required item is rejected**

- Preconditions: Same as TC-INSP-001
- Steps: Complete checklist but leave one required item unanswered; tap Submit
- Expected result: API returns 400 with field-level error identifying the missing item; no Inspection record is created
- Failure severity: BLOCKING

**TC-INSP-003: Operator with expired certification gets 403**

- Preconditions: Same setup as TC-AUTH-007
- Steps: Complete checklist fully; tap Submit
- Expected result: 403 with `code: CERT_EXPIRED`; PWA shows expiry date; no record created
- Failure severity: BLOCKING

**TC-INSP-004: Duplicate Idempotency-Key returns original result**

- Preconditions: A valid inspection has already been submitted with Idempotency-Key `abc-123`
- Steps: Re-POST the same inspection payload with the same Idempotency-Key `abc-123`
- Expected result: API returns 200 with the original inspection ID; no second Inspection record is created in the database
- Failure severity: HIGH

**TC-INSP-005: Post-submission tampering of a response is blocked and detectable**

- Preconditions: A valid inspection with responses has been submitted; its content digest is sealed in the audit chain
- Steps: Attempt a direct UPDATE on an `inspection_responses` row; separately, recompute the content digest from the (unchanged) row and compare it to the value sealed in the chain
- Expected result: The UPDATE is rejected by the immutability trigger (ADR 0008); any out-of-band change would make the recomputed digest diverge from the sealed value
- Failure severity: BLOCKING

**TC-INSP-006: BOOLEAN_PHOTO_ON_FAIL item requires photo when answered No**

- Preconditions: Active template includes a `BOOLEAN_PHOTO_ON_FAIL` item
- Steps: Answer the item No; attempt to proceed without uploading a photo
- Expected result: PWA blocks progression to next item; photo upload is required before continuing
- Failure severity: HIGH

**TC-INSP-007: Submission round-trip completes within 2 seconds**

- Preconditions: Dev staging environment running; Operator on a connection simulating 4G (use Chrome DevTools network throttling)
- Steps: Submit a complete valid inspection; measure time from Submit tap to confirmation screen
- Expected result: Total round-trip is under 2 seconds
- Failure severity: MEDIUM

**TC-INSP-008: Submission survives a 30-second WiFi drop**

- Preconditions: Operator is on step 9 (Submit tapped) of the inspection flow
- Steps: Simulate network drop immediately after tapping Submit (disable WiFi on test device); restore network after 30 seconds
- Expected result: PWA retries automatically; submission succeeds on reconnect; operator never sees an error
- Failure severity: HIGH

**TC-INSP-009: Concurrent inspections on same equipment are both recorded**

- Preconditions: Two Operator accounts; `MAT-FL-001` in AWAITING_INSPECTION
- Steps: Both operators submit inspections for `MAT-FL-001` within 2 seconds of each other (via API calls)
- Expected result: Both Inspection records are persisted; equipment status reflects the later submission; no records are lost
- Failure severity: HIGH

**TC-INSP-010: Audit event is logged on every submission**

- Preconditions: None
- Steps: Submit any valid inspection; query `audit_db` for the event
- Expected result: INSPECTION_SUBMITTED event exists in `audit_db` with operator ID, equipment ID, and timestamp; event is chained (has `prev_hash`)
- Failure severity: BLOCKING

---

##### Voice Dictation

**TC-VOICE-001: Transcription returns within 5 seconds for a 15-second clip**

- Preconditions: AI Service running with `small.en` model loaded; 15-second test clip from the MAT lab
- Steps: Upload the audio clip via Media Service; call the transcription endpoint; measure response time
- Expected result: Transcript is returned in under 5 seconds; text is intelligible
- Failure severity: MEDIUM

**TC-VOICE-002: AI Service down falls back gracefully**

- Preconditions: AI Service container is stopped
- Steps: Attempt voice dictation on a checklist item
- Expected result: PWA shows "Voice unavailable, type your notes" message; notes field remains editable; submission is not blocked
- Failure severity: HIGH

**TC-VOICE-003: Low-confidence transcript requires explicit confirmation**

- Preconditions: AI Service returns a transcript with `lowConfidence: true`
- Steps: Receive a low-confidence transcript in the PWA notes field
- Expected result: PWA displays a warning banner; Submit is blocked until operator explicitly confirms the transcript
- Failure severity: HIGH

**TC-VOICE-004: Voice clips are not sent to any external API**

- Preconditions: Network monitoring tool (e.g., Wireshark or browser DevTools) is running
- Steps: Complete a voice dictation; observe all outbound network requests
- Expected result: Audio data is only sent to the local Media Service endpoint; no requests to external domains (OpenAI, AWS, Google, etc.)
- Failure severity: BLOCKING

**TC-VOICE-005: Voice clip deleted after 90 days; transcript retained**

- Preconditions: A voice clip was uploaded 91 days ago (simulate by setting `created_at` in the database to 91 days ago); lifecycle job is configured
- Steps: Run the lifecycle job
- Expected result: Voice clip is deleted from Azure Blob Storage; Inspection record still contains the transcript text; `voiceClipId` on the response is nulled or marked deleted
- Failure severity: HIGH

---

##### Defect Workflow

**TC-DEFECT-001: FAIL_BLOCKING inspection creates a Defect record**

- Preconditions: Active checklist template with one BLOCKING item; Operator logged in
- Steps: Submit inspection with BLOCKING item answered as failed
- Expected result: One Defect record is created in the database; `status = OPEN`; equipment is OUT_OF_SERVICE; audit event DEFECT_OPENED logged
- Failure severity: BLOCKING

**TC-DEFECT-002: Supervisor email notification arrives within 60 seconds**

- Preconditions: Supervisor user has a valid email address in the system; SMTP relay is running
- Steps: Submit an inspection with a BLOCKING failure; monitor the Supervisor's inbox
- Expected result: Email arrives within 60 seconds; subject line does not contain PII; email contains Defect ID and equipment asset tag
- Failure severity: HIGH

**TC-DEFECT-003: Supervisor can acknowledge a defect**

- Preconditions: Defect is in OPEN status; Supervisor logged in
- Steps: Open defect inbox; locate the defect; tap Acknowledge
- Expected result: Defect status changes to ACKNOWLEDGED; audit event logged; Operator receives notification
- Failure severity: HIGH

**TC-DEFECT-004: Defect resolution requires notes of at least 20 characters**

- Preconditions: Defect is in ACKNOWLEDGED status; Supervisor logged in
- Steps: Attempt to mark defect RESOLVED with resolution notes of 10 characters
- Expected result: Validation error; defect status does not change
- Failure severity: MEDIUM

**TC-DEFECT-005: Return-to-service approval is separate from defect resolution**

- Preconditions: All blocking defects on `MAT-FL-001` are RESOLVED; Supervisor logged in
- Steps: Verify that equipment is still OUT_OF_SERVICE after defect resolution; tap "Approve Return to Service"
- Expected result: Equipment only returns to AWAITING_INSPECTION after the explicit approval action; resolving defects alone does not change equipment status
- Failure severity: BLOCKING

---

##### Manager Dashboard

**TC-DASH-001: Dashboard initial load is under 1.5 seconds**

- Preconditions: All 10 equipment records seeded; Manager logged in; cache cleared
- Steps: Load the dashboard home page; measure time to interactive
- Expected result: Compliance grid is visible and populated within 1.5 seconds
- Failure severity: MEDIUM

**TC-DASH-002: Filter changes update results within 500ms**

- Preconditions: Dashboard is loaded with data
- Steps: Change the equipment type filter; measure time until results update
- Expected result: Results update within 500ms
- Failure severity: MEDIUM

**TC-DASH-003: New inspection appears within 5 seconds via polling**

- Preconditions: Dashboard is open in one browser; a second browser is open as an Operator
- Steps: Operator submits a new inspection; observe the dashboard
- Expected result: The new inspection result appears in the compliance grid within 5 seconds without a manual page refresh
- Failure severity: MEDIUM

**TC-DASH-004: Operator cannot access dashboard**

- Preconditions: Operator is logged in
- Steps: Navigate directly to the dashboard URL
- Expected result: Operator is redirected or shown an access-denied screen; no compliance data is visible
- Failure severity: BLOCKING

---

##### Audit and Reporting

**TC-AUDIT-001: Hash chain verification passes on startup**

- Preconditions: At least 100 audit events exist in `audit_db`
- Steps: Restart the Audit Service container; check startup logs
- Expected result: Log shows chain verification PASS; no FAIL events or broken-chain alerts
- Failure severity: BLOCKING

**TC-AUDIT-002: PDF export is digitally signed and contains the audit chain segment**

- Preconditions: At least 5 inspections exist; Manager is logged in
- Steps: Export a PDF for the last 7 days; open the PDF
- Expected result: PDF contains a digital signature; each inspection shows its content digest; the appendix contains `prev_hash` and `this_hash` for each audit event in the range
- Failure severity: HIGH

**TC-AUDIT-003: Audit events cannot be updated or deleted**

- Preconditions: An audit event exists with a known ID
- Steps: Attempt `UPDATE audit_events SET ... WHERE id = ...` directly against the `audit_db` PostgreSQL role used by the Audit Service
- Expected result: PostgreSQL permission denied; no row is modified
- Failure severity: BLOCKING

**TC-AUDIT-004: Tampered audit chain triggers an alert**

- Preconditions: Direct database access to `audit_db` using an admin role (not the service role)
- Steps: Manually update one `prev_hash` field to a random value; restart the Audit Service
- Expected result: Startup chain verification logs FAIL with the broken event ID; a critical alert is logged; Admin is notified
- Failure severity: BLOCKING

**TC-AUDIT-005: CSV export is UTF-8 with BOM**

- Preconditions: Manager or Admin is logged in; inspection data exists
- Steps: Export CSV for any date range; open the file in a hex editor
- Expected result: First three bytes are `EF BB BF` (UTF-8 BOM); file opens correctly in Excel with no character encoding errors
- Failure severity: LOW

---

##### Security

**TC-SEC-001: Endpoints without declared role return 403**

- Preconditions: A test endpoint is created without a `preHandler: [requireRole(...)]` declaration (or test an existing endpoint)
- Steps: Call the endpoint with a valid JWT
- Expected result: 403 is returned; the endpoint does not serve data
- Failure severity: BLOCKING

**TC-SEC-002: Operator JWT is rejected on Supervisor-only endpoints**

- Preconditions: Operator is logged in; a valid Operator JWT is available
- Steps: Call `POST /api/v1/defects/:id/acknowledge` with the Operator JWT
- Expected result: 403 returned; defect status does not change
- Failure severity: BLOCKING

**TC-SEC-003: SQL injection attempt on search parameters is rejected**

- Preconditions: Any authenticated user
- Steps: Send `GET /api/v1/equipment?location=' OR '1'='1` or a similar injection string
- Expected result: Drizzle parameterizes the query; no data leak; response is an empty list or a 400 validation error
- Failure severity: BLOCKING

**TC-SEC-004: JWT from a foreign Entra ID tenant is rejected**

- Preconditions: A JWT signed by a different Azure tenant is available
- Steps: Call any authenticated API endpoint with the foreign JWT
- Expected result: 401 returned; JWKS validation fails because the signing key does not match the configured tenant
- Failure severity: BLOCKING

**TC-SEC-005: Trivy scan finds no HIGH or CRITICAL CVEs in built images**

- Preconditions: All four service images are built from current `main`
- Steps: Run `trivy image` against each built image
- Expected result: Zero HIGH or CRITICAL findings with available patches; any exceptions are documented with justification
- Failure severity: BLOCKING

---

**Total test cases: 59**

| Area                             | Count  |
| -------------------------------- | ------ |
| Authentication and Authorization | 10     |
| Equipment Management             | 10     |
| Checklist Templates              | 5      |
| Inspection Submission            | 10     |
| Voice Dictation                  | 5      |
| Defect Workflow                  | 5      |
| Manager Dashboard                | 4      |
| Audit and Reporting              | 5      |
| Security                         | 5      |
| **Total**                        | **59** |

---

## Phase 3: Test Execution

### 1. Test Environment Setup

The application runs in Docker Compose on the team-owned mini-PC. This satisfies the "no localhost" requirement: the environment is isolated, observable, and exhibits production-like behaviour.

**Setup steps before each test session:**

1. SSH into the mini-PC via Tailscale.
2. Run `docker compose -f docker/compose.dev.yml down -v` to clear all volumes.
3. Run `docker compose -f docker/compose.dev.yml up -d` to start a clean stack.
4. Run `npm run db:seed` from the repo root to load synthetic test data.
5. Verify all services are healthy: `docker compose ps` should show all services as `healthy`.
6. Confirm Grafana and Uptime Kuma dashboards are accessible before beginning.

### 2. Execution Steps

**Functional testing:** execute each test case in Section 10 in order. Record result (pass/fail), actual result observed, and any defect ID if applicable.

**Performance testing:** TC-INSP-007 and TC-DASH-001 through TC-DASH-002 are the performance cases. Use Chrome DevTools Network tab for timing measurements. Record the measured value alongside the pass/fail result.

**Automated testing:** unit and integration tests run in CI on every PR. System-level automated tests (security scans) run in CI. Do not re-run these manually unless diagnosing a specific failure.

### 3. Documentation

**Daily testing outcome log:** the DevOps/QA member records the following each day during Sprint 4 and 5 test execution:

- Date
- Number of test cases attempted
- Number passed
- Number failed
- New defects found
- Defects resolved since last session

**Defect tracking spreadsheet:** one row per defect found during system or UAT testing. Columns:

| Column             | Description                          |
| ------------------ | ------------------------------------ |
| Defect ID          | Sequential: D-001, D-002, etc.       |
| Test case          | The TC-xxx that found it             |
| Description        | What went wrong                      |
| Severity           | BLOCKING, HIGH, MEDIUM, LOW          |
| Steps to reproduce | Exact steps from a clean environment |
| Environment        | Dev staging; include git commit SHA  |
| Status             | OPEN, IN_PROGRESS, RESOLVED, CLOSED  |
| Fix reference      | Git commit SHA or PR number          |

**Test case execution progress:** after each day, compute the pass rate: (cases passed / cases attempted). Record this in the daily log. A pass rate above 90% by the end of Sprint 4 system testing indicates the system is ready for the simulated pilot.

**Defect backlog:** if any defects cannot be resolved before the simulated pilot, document them in a separate backlog table with severity and rationale for deferral. BLOCKING severity defects may not be deferred; the pilot must be rescheduled instead.

---

_See `FRS.md` for acceptance criteria. See `ARCHITECTURE.md` for system design. See `software_testing_guideline.md` for the framework this plan is based on._

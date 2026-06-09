# Product Requirements Document (PRD)

## MAT-Inspect: Pre-Use Inspection System

**Version:** 1.0 | **Date:** May 18, 2026
**Stack:** Next.js 15 + TypeScript, Node.js + Fastify, Python + FastAPI, PostgreSQL, Azure AD / Entra ID, MinIO, Docker, faster-whisper, Tailwind CSS
**Purpose:** Reference document defining WHAT we are building and WHY for the MAT School capstone project

---

## 1. PRODUCT OVERVIEW

### Vision

Replace paper pre-use inspection sheets at SAIT's MAT (Manufacturing, Automation, Transportation) School with a compliance-grade digital system. Operators inspect equipment via mobile QR scan; managers see live compliance; auditors get tamper-evident records on demand.

### Business Goals

| Goal                           | Current State                          | Target                                      |
| ------------------------------ | -------------------------------------- | ------------------------------------------- |
| Inspection completion rate     | ~60% (paper, often skipped)            | 100% (system enforces before equipment use) |
| Audit retrieval time           | Hours to days (paper files)            | Under 1 minute (filtered PDF export)        |
| Defect-to-acknowledgement time | Often missed                           | Under 1 hour (auto-notification)            |
| Records retention              | Variable, paper-based                  | 7 years, indexed, queryable                 |
| Inspection variability         | High (handwritten, inconsistent items) | Zero (versioned digital templates)          |
| Manager visibility             | None during shift                      | Real-time dashboard                         |
| Alberta OHS audit risk         | High (cannot demonstrate compliance)   | Low (cryptographically signed records)      |

---

## 2. TARGET USERS

### User Roles

**Operator (Lab Tech)**

- Scans QR code, completes inspection on phone, dictates defect notes by voice, submits with signature.

**Supervisor**

- All Operator rights, plus: acknowledges defects, approves return-to-service after repair, monitors team compliance.

**Manager**

- Read access to all data, daily compliance dashboard, exports reports.

**Admin (SAIT IT)**

- System config, checklist template editor, user role management.

**Auditor (read-only, time-boxed)**

- Read-only access to inspection records and exports. Account access is time-limited per audit engagement.

Roles are not hierarchical in code; they are explicit permission sets. A user may hold multiple roles (e.g., a Supervisor is also an Operator on the floor).

---

## 3. USER PERSONAS

### Persona 1: David, MAT Lab Tech

- **Profile:** Operates 3 to 4 pieces of equipment per shift across a 6-month rotation
- **Primary Need:** Get the inspection done in under 2 minutes without removing gloves
- **Key Pain Point:** Current paper sheets often missing from clipboards; never sure if last operator's inspection still counts for this shift
- **Critical Features:** QR scan, large touch targets, voice-to-text for defect notes, offline submission queue, clear pass or fail result

### Persona 2: Janet, Lab Supervisor

- **Profile:** Oversees 6 to 7 Lab Techs across one shift; manages defect resolution and equipment availability
- **Primary Need:** Know immediately when equipment goes out of service so she can route work around it
- **Key Pain Point:** Finds out about defects hours later through verbal reports; no audit trail of who reported what when
- **Critical Features:** Real-time email and push notifications on defect, defect inbox, return-to-service approval workflow, supervisor dashboard view

### Persona 3: Robert, MAT School Operations Manager

- **Profile:** Responsible for the school's overall compliance posture; reports to SAIT executive on safety metrics
- **Primary Need:** Be able to demonstrate at any moment that the school is meeting Alberta OHS requirements
- **Key Pain Point:** Current paper system means an audit triggers a frantic two-week search for records; trends are invisible
- **Critical Features:** Live compliance dashboard, equipment history drilldown, signed PDF export for any date range, trend visualization

### Persona 4: Patricia, Alberta OHS Inspector (external)

- **Profile:** Conducts unannounced inspections of training and industrial facilities; not employed by SAIT
- **Primary Need:** Verify inspection records are authentic and complete; identify any unsafe equipment in use
- **Key Pain Point:** Paper records are often incomplete, unsigned, or contradictory across copies
- **Critical Features:** Signed PDF reports with hash chain verification, read-only auditor account, full inspection history per piece of equipment

### Persona 5: Alex, SAIT IT Admin

- **Profile:** Inherits the system after capstone handover; manages it as part of broader SAIT IT portfolio
- **Primary Need:** Run the system with minimal effort; respond to incidents using a runbook
- **Key Pain Point:** Inheriting capstone projects often means undocumented, fragile systems with no operational guide
- **Critical Features:** Complete operations runbook, Docker-based deployment, observability with alerts, backup automation, clear handover documentation

---

## 4. FEATURE PRIORITIZATION

### P0: Launch Blockers (cannot ship without)

- Entra ID authentication with role-based access control
- Equipment registry with QR-code addressable assets (10 machines at MVP)
- Versioned checklist templates per equipment class (overhead crane, forklift, truck, electric pallet jack)
- Inspection submission with operator attestation (ADR 0007)
- Equipment status state machine (READY, AWAITING_INSPECTION, OUT_OF_SERVICE, RETIRED)
- Pass and Fail flows with automatic defect creation on blocking failures
- Defect workflow with supervisor acknowledgement and return-to-service approval
- Manager dashboard with daily compliance grid and defect inbox
- Append-only audit log with hash chain for tamper evidence
- SMTP email notifications for failed inspections

### P1: Core Differentiators (must ship for capstone defense)

- Voice-to-text defect notes via on-prem AI Service (faster-whisper small.en)
- Photo evidence capture and storage for defect items
- PWA offline mode with submission queueing
- PDF report export with embedded photos, signatures, and audit chain segment
- CSV export for managers
- Hash chain verification on Audit Service startup and on export
- 7-year retention for inspection records, 90-day retention for voice audio
- Web Push notifications for on-shift supervisors

### P2: Value Adds (if Sprint 3 has capacity)

- Photo defect classification (AI suggests category from photo)
- Inspection trend visualization in dashboard
- Per-operator inspection history and certification expiry warnings
- Equipment-specific defect frequency reports

### P3: Future (post-capstone, v2)

- Multi-campus support (Aero Centre, Pt. Trotter)
- Native mobile apps (iOS, Android)
- LLM-generated defect summaries for managers
- Anomaly detection on inspection trends
- Predictive maintenance scheduling
- Integration with equipment manufacturer telemetry
- Microsoft Entra ID federation for SAIT SSO (configurable now, deferred for capstone)
- mTLS between internal services

---

## 5. USER STORIES (Critical Path)

### Authentication and Authorization

- As a Lab Tech, I want to log in once at shift start and stay logged in for the shift so I do not re-enter credentials between equipment
- As a Manager, I want my account to require MFA so a stolen password alone does not give access to compliance records
- As an Admin, I want to deactivate a user instantly when they leave SAIT so they cannot access the system
- As an Auditor, I want my account to expire automatically at the end of my audit engagement so my access does not persist

### Equipment and QR Scan

- As a Lab Tech, I want to scan the equipment QR sticker with my phone camera and immediately see the inspection checklist for that machine
- As an Admin, I want to add a new piece of equipment with a unique asset tag and generate a printable QR code for it

### Inspection Submission

- As a Lab Tech, I want each checklist item to clearly indicate whether failure is blocking or just a warning so I know whether the equipment is usable
- As a Lab Tech, I want required fields to be obviously marked and the submit button disabled until all are complete
- As a Lab Tech, I want to dictate defect notes by voice when I have gloves on so I do not have to remove them to type
- As a Lab Tech, I want to capture a photo for any failed item so the supervisor can see the issue visually
- As a Lab Tech, I want to see green PASS or red FAIL clearly after submitting so I know whether to operate the equipment

### Defect Workflow

- As a Supervisor, I want to receive an email and push notification the moment any equipment fails inspection on my shift
- As a Supervisor, I want to acknowledge a defect, assign it to a qualified person, and track repair progress
- As a Supervisor, I want to approve return-to-service after repair so equipment is not used prematurely
- As a Lab Tech, I want a digital lockout tag to display on screen with equipment ID after a failed inspection so I have a clear record of the failure

### Manager Visibility

- As a Manager, I want a daily compliance grid showing every piece of equipment, its last inspection, who did it, and the result
- As a Manager, I want to drill into any piece of equipment and see its full history including photos and voice clips with transcripts
- As a Manager, I want to filter inspections by date range, equipment type, location, and operator so I can investigate patterns

### Audit and Reporting

- As an Auditor, I want to export a signed PDF for any equipment over any date range that includes all responses, photos, and audit chain segment
- As an Auditor, I want to verify the audit chain hash independently so I can confirm records have not been tampered with
- As a Manager, I want to export CSV data for spreadsheet analysis
- As an Admin, I want all access to audit records to itself be audited so I can investigate suspicious activity

### Operator Self-Service

- As a Lab Tech, I want to see my own inspection history so I can refresh on equipment I have not used recently
- As a Lab Tech, I want to be warned when my certification is expiring within 30 days so I can renew on time
- As a Lab Tech expired on a class, I want to be told clearly why I cannot submit instead of getting a vague error

---

## 6. KEY BUSINESS RULES

### Inspection State Machine

- Equipment defaults to AWAITING_INSPECTION at start of each shift window
- An Inspection with `result = PASS` is required to transition Equipment to READY
- Any blocking failure transitions Equipment to OUT_OF_SERVICE automatically and creates a Defect
- Equipment in OUT_OF_SERVICE cannot transition to READY without: (a) Defect status RESOLVED, (b) supervisor return-to-service approval, (c) a fresh passing Inspection
- Inspections are immutable after submission; corrections create a new linked Inspection referencing the original

### Operator Eligibility

- Operator must hold an active, non-expired certification for the equipment class they are inspecting
- Expired or missing certification: submission is rejected with a clear error message
- Certification expiry warnings sent by email at 30, 14, and 7 days before expiry

### Defect Workflow

- Every blocking failure creates exactly one Defect
- Defect status flow: OPEN to ACKNOWLEDGED to IN_REPAIR to RESOLVED or REJECTED
- Only Supervisor or Manager role can transition a Defect to RESOLVED
- Return-to-service approval is a separate explicit action; it is not implied by Defect resolution

### Records Retention

- Inspection records: 7 years from submission date
- Audit events: 7 years from event time
- Voice audio clips: 90 days from creation; transcripts retained the full 7 years
- Photos: 7 years from upload
- Soft-deleted users: preserved indefinitely in the audit chain; hard delete only on legal request with audit event recording the reason

### Audit Log Integrity

- Every audit event stores `prev_hash` and `this_hash` (SHA-256)
- Audit Service verifies chain integrity on startup
- Export PDFs include the relevant hash chain segment for independent verification
- The audit_db Postgres role has INSERT only; UPDATE and DELETE are revoked

### AI Boundaries

- AI Service is assistive only; it does not auto-pass or auto-fail any inspection
- Operator must review and confirm any AI-generated transcript before submission
- The `notes_source` field on InspectionResponse tracks whether AI output was edited (VOICE_TRANSCRIBED or VOICE_EDITED)
- AI Service failure does not block inspection submission; PWA falls back to typed notes

### Authentication

- JWT access token lifetime: 15 minutes
- Refresh token lifetime: 7 days, rotated on use
- MFA required for Supervisor, Manager, Admin roles
- Account lockout after 5 failed login attempts within 30 minutes

### Naming Conventions

- Equipment asset tag format: `MAT-{TYPE_CODE}-{NNN}` where TYPE_CODE is OC (overhead crane), TR (truck), PJ (pallet jack), FL (forklift). Example: `MAT-FL-002`
- Inspection ID: UUID v7 (time-ordered)
- Defect ID: UUID v7
- Audit event ID: UUID v7

---

## 7. NON-FUNCTIONAL REQUIREMENTS

### Performance

| Metric                                    | Target                                 |
| ----------------------------------------- | -------------------------------------- |
| QR scan to checklist display              | Under 2 seconds                        |
| Inspection submission round trip          | Under 2 seconds                        |
| Voice transcription (15-second clip)      | Under 5 seconds                        |
| Dashboard initial load                    | Under 1.5 seconds                      |
| Dashboard filter or drilldown             | Under 500 ms                           |
| PDF report generation (single inspection) | Under 3 seconds                        |
| Concurrent users supported                | 20+ (well above expected 7-tech shift) |
| System uptime                             | 99.5%                                  |

### Security

- TLS 1.3 everywhere; no plain HTTP
- JWT validation at API gateway and at each service
- RBAC fail-closed: endpoints without declared roles return 403
- Passwords: managed by Entra ID (not the application)
- Rate limiting: 100 requests per minute per IP at gateway
- All write endpoints accept Idempotency-Key header
- Audit log append-only at the database role level
- Container security: non-root user, read-only root filesystem, dropped capabilities
- Dependency scanning: Trivy on every image build, Semgrep on source, Gitleaks on commit
- Operator attestation on every Inspection submission; tamper-evidence via the hash-chained audit log and content digest (ADR 0007, ADR 0008)

### Compliance

- Alberta OHS Code Part 19 (Powered Mobile Equipment, s.257, s.260)
- Alberta OHS Code Part 6 (Cranes, Hoists, Lifting Devices)
- CSA B167 (overhead cranes), CSA B335 (forklift training)
- Alberta FOIP Act (data stored on SAIT-controlled infrastructure)
- OWASP Top 10 (2021) mitigations across the stack
- OWASP ASVS Level 2 as a target

### Accessibility

- WCAG 2.1 Level AA
- Minimum touch target: 44 by 44 px (glove-friendly)
- Minimum color contrast: 4.5:1 for text
- Status indicators use icon + label + color (never color alone)
- Keyboard navigation on all dashboard flows
- Screen reader support for all interactive elements
- High-contrast theme available

### Browser and Device Support

- Mobile: iOS 16+, Android 12+ (Lab Techs use issued phones)
- Desktop: Chrome, Edge, Firefox, Safari (last 2 major versions)
- Responsive: 360 px minimum width
- PWA installable on mobile devices for offline operation

### Internationalization

- English only at MVP
- Architecture supports future French localization via i18next on the frontend and message keys in the API

---

## 8. EQUIPMENT AND CHECKLIST SPECIFICATIONS

### Equipment Classes Supported (MVP)

| Class                | Code | Count | Standard                   |
| -------------------- | ---- | ----- | -------------------------- |
| Overhead crane       | OC   | 4     | CSA B167                   |
| Truck                | TR   | 2     | OHS Code Part 19           |
| Electric pallet jack | PJ   | 1     | OHS Code Part 19           |
| Forklift             | FL   | 3     | CSA B335, OHS Code Part 19 |

### Checklist Item Types

| Type                  | Description                     | Validation             |
| --------------------- | ------------------------------- | ---------------------- |
| BOOLEAN               | Yes or No                       | Required answer        |
| BOOLEAN_PHOTO_ON_FAIL | Yes or No; photo required if No | Photo upload validated |

Items are boolean only. An abnormal reading goes in free-text notes against the item (max
500 characters), not as structured numeric data. The operator attestation is a single
confirm action over the whole Inspection, not a per-item signature (ADR 0007).

### Inspection Results

| Result        | Trigger                                       | Equipment Status After    |
| ------------- | --------------------------------------------- | ------------------------- |
| PASS          | All required items passed                     | READY                     |
| FAIL_WARNING  | Non-blocking item failed; usable with caution | READY (with warning flag) |
| FAIL_BLOCKING | Any blocking item failed                      | OUT_OF_SERVICE            |

### Defect Severity

| Level    | Effect                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------ |
| BLOCKING | Equipment cannot be used; Defect must be RESOLVED + supervisor approval before return to service |
| WARNING  | Equipment usable; Defect logged for tracking; no out-of-service trigger                          |

---

## 9. EMAIL AND PUSH NOTIFICATIONS

| Trigger                                       | Recipient                         | Channel                           |
| --------------------------------------------- | --------------------------------- | --------------------------------- |
| User account created                          | Operator, Supervisor, Manager     | Email (welcome + onboarding link) |
| Password reset requested                      | User                              | Email (1-hour token)              |
| Failed inspection submitted                   | All Supervisors on shift          | Email + Web Push                  |
| Defect acknowledged                           | Inspection operator               | Email                             |
| Defect resolved                               | Inspection operator, Supervisor   | Email                             |
| Return-to-service approved                    | Lab Tech who reported, Supervisor | Email                             |
| Certification expiry warning (30, 14, 7 days) | Operator, Supervisor              | Email                             |
| Inspection not performed by mid-shift         | On-shift Supervisor               | Email + Web Push                  |
| Audit chain verification failure              | Admin                             | Email (critical alert)            |
| Backup failure                                | Admin                             | Email (critical alert)            |

---

## 10. DEVELOPMENT TIMELINE

See `docs/ARCHITECTURE.md` Section 15 for the full sprint plan. Summary:

| Phase                                    | Weeks   | Focus                                                                                |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| Sprint 0: Discovery and Setup            | 1 to 2  | Stakeholder interviews, dev staging on team mini-PC, repo, CI                        |
| Sprint 1: Auth, Equipment, Checklists    | 3 to 4  | Entra ID integration, equipment registry, checklist templates, PWA login and QR scan |
| Sprint 2: Inspection and Defect Workflow | 5 to 6  | Submission, state machine, defect flow, email notifications                          |
| Sprint 3: Dashboard, Media, AI           | 7 to 8  | Manager dashboard, photo upload, AI voice-to-text                                    |
| Sprint 4: Audit, Reports, SAIT Migration | 9 to 10 | Hash chain, PDF and CSV exports, migrate stack to SAIT VM                            |
| Sprint 5: Pilot                          | 11      | Real Lab Tech use of staging system on SAIT infrastructure                           |
| Sprint 6: Production Rollout             | 12      | Production deployment, training, cutover from paper                                  |
| Sprint 7: Stabilization and Handover     | 13      | Bug fixes, documentation, capstone presentation                                      |

**Final deliverable date: August 15, 2026.**

---

## 11. EXTERNAL DEPENDENCIES

| Service or Library     | Purpose                                                    | Hosting Choice                                                  |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Azure AD / Entra ID    | Authentication and identity                                | SAIT existing tenant; provided by SAIT IT                       |
| PostgreSQL 16          | Primary relational data                                    | Self-hosted Docker container; managed Postgres if on Azure      |
| MinIO                  | S3-compatible object storage for photos, voice clips, PDFs | Self-hosted Docker container; or Azure Blob Storage on Azure    |
| faster-whisper         | On-prem speech-to-text                                     | Self-hosted Docker container, CPU inference                     |
| SMTP                   | Outbound email                                             | SAIT institutional SMTP relay (preferred) or SendGrid free tier |
| GitHub                 | Source control, CI/CD                                      | GitHub Free for educational use                                 |
| Docker, Docker Compose | Container runtime                                          | Self-hosted, all environments                                   |

No payment processing. No third-party AI APIs in production (all AI inference is on-prem).

---

## 12. SUCCESS METRICS (POST-LAUNCH)

| Metric                                  | Baseline (paper)       | Target (6 months post-launch)           |
| --------------------------------------- | ---------------------- | --------------------------------------- |
| Inspection completion rate per shift    | ~60%                   | 100% (system enforced)                  |
| Time to audit retrieval                 | Hours to days          | Under 1 minute                          |
| Defect-to-acknowledgement time          | Often unmeasured       | Median under 1 hour                     |
| Audit log integrity violations          | Cannot detect          | Zero detected                           |
| Voice dictation usage rate (P1 feature) | N/A                    | 40% of defect notes use voice           |
| Supervisor satisfaction                 | Frustration with paper | 4.0 or above on internal survey         |
| External audit findings                 | Pending                | Zero findings related to record-keeping |

---

## 13. RISKS AND MITIGATIONS

See `docs/ARCHITECTURE.md` Section 18 for the full risk register. Top risks:

| Risk                                                          | Mitigation                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Sponsor checklist content not finalized in time               | Lock content by end of Week 4                                                                                |
| Campus IT delays hosting approval past Sprint 4               | Dev staging on team mini-PC bridges Sprint 0 to 4; escalate to sponsor if SAIT VM is not ready by Week 9     |
| Whisper accuracy too low in a loud shop                       | Quiet-step requirement (operator moves 2 metres from equipment); fallback to typed notes always available    |
| One student leaves the project                                | Cross-training; every feature has a backup owner                                                             |
| Audit chain bug undermines legal value                        | Two reviewers on Audit Service code; integration test with 10,000 simulated events                           |
| Real Lab Tech data accidentally written to team-owned mini-PC | Tear-down of dev staging realm at end of Sprint 4; Sprint 5 onward uses synthetic data only on team hardware |

---

_For detailed functional specifications and acceptance criteria, see `FRS.md`. For API contracts, see `API_REFERENCE.md`. For the system architecture and sprint plan, see `ARCHITECTURE.md`._

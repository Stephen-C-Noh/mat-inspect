# API_REFERENCE.md (Version 1)

## MAT-Inspect: Endpoint Quick Reference

**Base URL (local dev):** `http://localhost:8080/api/v1`
**Base URL (dev staging):** `https://mat-inspect.staging/api/v1`
**Base URL (production):** TBD by SAIT IT (likely `https://mat-inspect.sait.ca/api/v1`)
**Auth:** `Authorization: Bearer <JWT>` issued by Entra ID

**Indicators:** 🔓 public · 🔒 authenticated · 👤 operator · 👷 supervisor · 📊 manager · 🛡️ admin · 🔍 auditor

**All responses use RFC 7807 problem+json format on error.** Success responses return the resource directly, not wrapped in `{ success, data }`.

**Path convention for admin endpoints:** admin-only endpoints are distinguished by role gating (🛡️, `requireRole('admin')`), not by a path prefix. There is no `/admin/*` namespace. An admin route sits alongside its resource (for example, publishing a checklist is `POST /checklists`, gated to admin). This matches the implemented routes; the reference lists admin endpoints under their resource with the 🛡️ indicator.

---

## Authentication

Authentication is handled by Entra ID. The application exposes thin wrappers for session-level operations only. User account management, password reset, and MFA setup are handled by SAIT IT via the Azure portal.

| Method | Endpoint                  | Auth | Description                                          |
| ------ | ------------------------- | ---- | ---------------------------------------------------- |
| POST   | `/auth/session/refresh`   | 🔒   | Exchange refresh token for new access token          |
| POST   | `/auth/session/logout`    | 🔒   | Invalidate current session                           |
| GET    | `/auth/me`                | 🔒   | Current user profile with role(s) and certifications |
| GET    | `/auth/me/certifications` | 🔒   | Current user's certifications with expiry status     |

**Login flow:** PWA redirects to the Entra ID authorization endpoint. After login, Entra ID redirects back with an authorization code. PWA exchanges the code for tokens via MSAL. Standard OIDC, no custom endpoint.

---

## Equipment

| Method | Endpoint                 | Auth | Description                                    |
| ------ | ------------------------ | ---- | ---------------------------------------------- |
| GET    | `/equipment`             | 🔒   | List equipment, paginated, filterable          |
| GET    | `/equipment/:assetTag`   | 🔒   | Resolve QR code to equipment record            |
| GET    | `/equipment/:id/history` | 🔒   | Inspection and defect history for an equipment |
| GET    | `/equipment/:id/qr`      | 🛡️   | Generate printable QR sticker PDF              |
| POST   | `/equipment`             | 🛡️   | Create equipment                               |
| PATCH  | `/equipment/:id`         | 🛡️   | Update equipment metadata (not status)         |
| POST   | `/equipment/:id/retire`  | 🛡️   | Soft-retire (status → RETIRED, no hard delete) |

**GET /equipment query params:**
`type`, `location`, `status`, `cursor`, `limit` (default 50, max 100)

---

## Checklist Templates

| Method | Endpoint                        | Auth | Description                                            |
| ------ | ------------------------------- | ---- | ------------------------------------------------------ |
| GET    | `/checklists/active`            | 🔒   | Active template for an equipment type                  |
| GET    | `/checklists/:id`               | 🔒   | Specific template version (for historical inspections) |
| GET    | `/checklists`                   | 🛡️   | List all templates and versions                        |
| POST   | `/checklists`                   | 🛡️   | Publish a new template version                         |
| GET    | `/checklists/:id/diff/:otherId` | 🛡️   | Diff between two template versions                     |

**GET /checklists/active query params:**
`type` (required, enum: OVERHEAD_CRANE, TRUCK, ELECTRIC_PALLET_JACK, FORKLIFT)

---

## Inspections

| Method | Endpoint                           | Auth | Description                                                    |
| ------ | ---------------------------------- | ---- | -------------------------------------------------------------- |
| POST   | `/inspections`                     | 👤   | Submit a completed inspection (idempotent via Idempotency-Key) |
| GET    | `/inspections`                     | 🔒   | List inspections, paginated, filterable                        |
| GET    | `/inspections/:id`                 | 🔒   | Get a single inspection with all responses                     |
| GET    | `/inspections/:id/photos/:photoId` | 🔒   | SAS URL to a photo                                             |
| GET    | `/inspections/:id/voice/:clipId`   | 🔒   | SAS URL to a voice clip (90-day retention)                     |
| GET    | `/me/inspections`                  | 🔒   | Current user's own inspection history                          |
| GET    | `/me/inspections/in-progress`      | 🔒   | Resumeable inspection from a crashed session, if any           |

**GET /inspections query params:**
`equipmentId`, `equipmentType`, `operatorId`, `result`, `dateFrom`, `dateTo`, `cursor`, `limit`

**Authorization rules:**

- Operator can read only their own inspections
- Supervisor can read all inspections (lab-wide; no shift partition exists, so a Supervisor monitoring team compliance sees everything)
- Manager, Admin, Auditor can read all

---

## Defects

| Method | Endpoint                                   | Auth | Description                                                 |
| ------ | ------------------------------------------ | ---- | ----------------------------------------------------------- |
| GET    | `/defects`                                 | 👷   | List defects, paginated, filterable                         |
| GET    | `/defects/:id`                             | 🔒   | Defect detail with linked inspection, photos, voice         |
| POST   | `/defects/:id/acknowledge`                 | 👷   | Mark OPEN → ACKNOWLEDGED                                    |
| POST   | `/defects/:id/assign`                      | 👷   | Assign to a named user (optional step)                      |
| POST   | `/defects/:id/resolve`                     | 👷   | Mark RESOLVED (requires `resolutionNotes`)                  |
| POST   | `/defects/:id/reject`                      | 👷   | Mark REJECTED with reason                                   |
| POST   | `/equipment/:id/approve-return-to-service` | 👷   | Approve return to service (separate from defect resolution) |

**GET /defects query params:**
`equipmentId`, `status`, `severity`, `assignedTo`, `dateFrom`, `dateTo`, `cursor`, `limit`

**Defect status flow:** `OPEN → ACKNOWLEDGED → IN_REPAIR → RESOLVED` or `REJECTED`

---

## Media

| Method | Endpoint        | Auth | Description                                 |
| ------ | --------------- | ---- | ------------------------------------------- |
| POST   | `/media/upload` | 🔒   | Upload photo or voice clip; returns mediaId |
| GET    | `/media/:id`    | 🔒   | SAS URL for download (15-min validity)      |

**POST /media/upload form fields:**

- `file` (binary): the photo or audio file
- `purpose` (string): `PHOTO_INSPECTION` or `VOICE_INSPECTION`
- `inspectionId` (uuid, optional): link to inspection if known

**Limits:**

- Photo: max 5 MB; JPEG, PNG, HEIC
- Voice: max 2 MB; webm, ogg, wav; max 30 seconds

---

## AI Service

| Method | Endpoint                    | Auth | Description                                       |
| ------ | --------------------------- | ---- | ------------------------------------------------- |
| POST   | `/ai/transcribe`            | 🔒   | Transcribe a voice clip already uploaded to Media |
| POST   | `/ai/classify-defect-photo` | 🔒   | (Stretch P2) Suggest defect category from photo   |
| GET    | `/ai/health`                | 🔓   | AI Service liveness check                         |

**POST /ai/transcribe body:**

```json
{
  "voiceClipId": "uuid"
}
```

**Response:**

```json
{
  "transcript": "Hydraulic leak around the left cylinder, about two inches by three inches",
  "language": "en",
  "confidence": 0.87,
  "lowConfidence": false,
  "processingMs": 3214
}
```

**Behavior:**

- Runs entirely on-prem; audio never leaves SAIT infrastructure
- If unreachable, callers fall back to typed notes
- `lowConfidence` true when overall confidence below 0.5; UI prompts careful review

---

## Reports and Exports

| Method | Endpoint              | Auth | Description                                 |
| ------ | --------------------- | ---- | ------------------------------------------- |
| POST   | `/reports/export`     | 👷   | Start an export job (PDF or CSV)            |
| GET    | `/reports/:jobId`     | 🔒   | Poll job status; returns SAS URL when ready |
| GET    | `/reports/me/exports` | 🔒   | List my export history                      |

**POST /reports/export body:**

```json
{
  "format": "PDF",
  "filters": {
    "equipmentIds": ["uuid", "uuid"],
    "dateFrom": "2026-05-01T00:00:00Z",
    "dateTo": "2026-05-31T23:59:59Z",
    "result": "FAIL_BLOCKING"
  },
  "options": {
    "includePhotos": true,
    "includeVoiceTranscripts": true,
    "includeAuditChainSegment": true
  }
}
```

**Response:**

```json
{
  "jobId": "uuid",
  "status": "PROCESSING",
  "estimatedSeconds": 8
}
```

**GET /reports/:jobId response (when ready):**

```json
{
  "jobId": "uuid",
  "status": "READY",
  "downloadUrl": "https://...azure blob sas url...",
  "expiresAt": "2026-05-17T18:00:00Z",
  "format": "PDF",
  "inspectionCount": 47,
  "fileBytes": 12834567,
  "sha256": "abc123..."
}
```

---

## Audit Events

Audit events are read-only via API. Writes happen automatically as a side effect of other actions.

| Method | Endpoint              | Auth | Description                                                   |
| ------ | --------------------- | ---- | ------------------------------------------------------------- |
| GET    | `/audit/events`       | 🛡️🔍 | List audit events, paginated, filterable                      |
| GET    | `/audit/events/:id`   | 🛡️🔍 | Single audit event with hash chain context                    |
| GET    | `/audit/verify-chain` | 🛡️🔍 | Run chain verification over a range; returns OK or breakpoint |

**GET /audit/events query params:**
`actorId`, `action`, `resourceType`, `resourceId`, `dateFrom`, `dateTo`, `cursor`, `limit`

---

## Admin: User Management

| Method | Endpoint                 | Auth | Description                                 |
| ------ | ------------------------ | ---- | ------------------------------------------- |
| GET    | `/users`                 | 🛡️   | List users, paginated                       |
| POST   | `/users`                 | 🛡️   | Create user with role(s) and certifications |
| PATCH  | `/users/:id`             | 🛡️   | Update display name, roles, certifications  |
| POST   | `/users/:id/deactivate`  | 🛡️   | Set active = false                          |
| POST   | `/users/:id/reactivate`  | 🛡️   | Set active = true                           |
| GET    | `/users/:id/data-export` | 🛡️🔒 | Export all data tied to a user (FOIP)       |

---

## Health and Status (Public)

| Method | Endpoint        | Auth | Description                                    |
| ------ | --------------- | ---- | ---------------------------------------------- |
| GET    | `/health`       | 🔓   | Liveness check; returns 200 if service running |
| GET    | `/health/ready` | 🔓   | Readiness check; verifies DB and dependencies  |
| GET    | `/version`      | 🔓   | Current deployed version and git commit        |

---

## Headers

### Request

| Header                           | Required             | Notes                                                                 |
| -------------------------------- | -------------------- | --------------------------------------------------------------------- |
| `Authorization: Bearer <JWT>`    | Yes for 🔒 endpoints | Token from Entra ID                                                   |
| `Idempotency-Key: <uuid>`        | Yes for POST writes  | Server caches result for 24 hours; resubmits return original response |
| `Content-Type: application/json` | Yes for JSON bodies  | `multipart/form-data` for /media/upload                               |
| `Accept-Language: en`            | Optional             | English only at MVP; planned for v2                                   |

### Response

| Header                  | Notes                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `X-Request-Id`          | Echoes or generates a UUID; use this when reporting errors |
| `X-RateLimit-Remaining` | Requests left in the current window                        |
| `Retry-After`           | On 429, seconds to wait before retry                       |

---

## Error Codes

| Code                                  | Status | Meaning                                                                |
| ------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `AUTH_TOKEN_MISSING`                  | 401    | No token provided                                                      |
| `AUTH_TOKEN_INVALID`                  | 401    | Token signature or claims invalid                                      |
| `AUTH_TOKEN_EXPIRED`                  | 401    | Access token past expiry; client should refresh                        |
| `AUTH_FORBIDDEN`                      | 403    | Authenticated but lacks the required role                              |
| `MFA_REQUIRED`                        | 403    | Role requires MFA; user has not completed second factor                |
| `CERT_EXPIRED`                        | 403    | Operator's certification for the equipment class has expired           |
| `CERT_MISSING`                        | 403    | Operator has no certification for this equipment class                 |
| `VALIDATION_ERROR`                    | 400    | Input failed Zod validation; includes per-field errors                 |
| `IDEMPOTENCY_MISMATCH`                | 409    | Same Idempotency-Key used with different body                          |
| `EQUIPMENT_NOT_FOUND`                 | 404    | Asset tag or ID does not resolve                                       |
| `EQUIPMENT_RETIRED`                   | 410    | Equipment exists but is RETIRED; cannot inspect                        |
| `EQUIPMENT_OUT_OF_SERVICE`            | 409    | Cannot mark READY; an unresolved Defect exists                         |
| `INSPECTION_NOT_FOUND`                | 404    |                                                                        |
| `INSPECTION_INCOMPLETE`               | 400    | Required items missing from submission                                 |
| `DEFECT_NOT_FOUND`                    | 404    |                                                                        |
| `DEFECT_INVALID_TRANSITION`           | 409    | Cannot transition Defect from current status to requested status       |
| `RETURN_TO_SERVICE_BLOCKED`           | 409    | Cannot approve return to service while a blocking Defect is unresolved |
| `CHECKLIST_TEMPLATE_NOT_FOUND`        | 404    | No active template for the equipment type, or no template with that id |
| `CHECKLIST_TEMPLATE_INVALID_REVIEWER` | 400    | reviewedBy must not be the publishing admin (no self-review)           |
| `MEDIA_TOO_LARGE`                     | 413    | Upload exceeds size limit                                              |
| `MEDIA_TYPE_INVALID`                  | 400    | Unsupported MIME type                                                  |
| `AI_SERVICE_UNAVAILABLE`              | 503    | AI Service down; client should fall back to typed notes                |
| `AUDIT_CHAIN_BROKEN`                  | 500    | Audit chain verification failed at the given event ID                  |
| `REPORT_JOB_NOT_FOUND`                | 404    |                                                                        |
| `RATE_LIMITED`                        | 429    | Too many requests; check Retry-After                                   |
| `INTERNAL_ERROR`                      | 500    | Unexpected server error; includes X-Request-Id for support             |

---

## Sample Error Response

```json
{
  "type": "https://mat-inspect.sait.ca/errors/cert-expired",
  "title": "Certification expired",
  "status": 403,
  "detail": "Your forklift certification expired on 2026-04-12. Renew before submitting forklift inspections.",
  "instance": "/api/v1/inspections",
  "code": "CERT_EXPIRED",
  "certificationType": "FORKLIFT",
  "expiredAt": "2026-04-12T00:00:00Z",
  "requestId": "01HXR7Z3K9N4F2VBTQM7E8YPGC"
}
```

---

## Idempotency

All POST endpoints that create resources accept `Idempotency-Key` (UUID v4 recommended). The server caches the response for 24 hours. Resubmitting with the same key returns the original response without re-executing the action.

This is critical for the offline-queue scenario: the PWA generates the key when the user taps Submit, regardless of whether network is available; on eventual sync, the same key prevents duplicate submissions.

---

## Pagination

Cursor-based, no offset. Forward-only.

**Request:**

```
GET /inspections?cursor=opaque-token&limit=50
```

**Response includes:**

```json
{
  "items": [...],
  "nextCursor": "opaque-token-or-null",
  "hasMore": true
}
```

`nextCursor` is null when there are no more results.

---

## Rate Limiting

| Endpoint Class           | Per-User Limit | Per-IP Limit |
| ------------------------ | -------------- | ------------ |
| Authentication endpoints | 10 / minute    | 30 / minute  |
| Read endpoints           | 200 / minute   | 600 / minute |
| Write endpoints          | 60 / minute    | 120 / minute |
| Export endpoints         | 5 / hour       | N/A          |

Exceeded limits return 429 with `Retry-After` header.

---

## Versioning

Current version: `v1`. All endpoints live under `/api/v1/`.

Backward-incompatible changes go to `/api/v2/`. Backward-compatible changes (new endpoints, new optional fields) stay in v1.

Both versions are served in parallel during transitions; clients are notified via the `Deprecation` and `Sunset` headers (per RFC 8594) at least 6 months before old version retirement.

---

_OpenAPI spec is auto-generated from Zod schemas; available at `/api/v1/openapi.json` when running locally._

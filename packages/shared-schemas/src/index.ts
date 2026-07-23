import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const equipmentTypeSchema = z.enum([
  'OVERHEAD_CRANE',
  'TRUCK',
  'ELECTRIC_PALLET_JACK',
  'FORKLIFT',
]);

export const equipmentStatusSchema = z.enum([
  'READY',
  'AWAITING_INSPECTION',
  'OUT_OF_SERVICE',
  'RETIRED',
]);

export const equipmentSchema = z.object({
  id: z.string().uuid(),
  assetTag: z.string().min(1),
  name: z.string().min(1),
  type: equipmentTypeSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  location: z.string().nullable(),
  status: equipmentStatusSchema,
  currentStatusSince: z.string().datetime(),
  // Read-side stays lenient: the column is free text and one malformed value must not 500
  // the whole equipment list (DEV-54). URL format is enforced on the write path (DEV-24).
  manufacturerSpecsUrl: z.string().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Equipment = z.infer<typeof equipmentSchema>;

// Only three types render (DEV-16, DEV-75). SIGNATURE is rejected by ADR 0007 and
// MEASUREMENT is out of scope; abnormal readings go in free-text notes (FRS).
export const checklistItemTypeSchema = z.enum(['BOOLEAN', 'BOOLEAN_PHOTO_ON_FAIL', 'TEXT']);

export const failSeveritySchema = z.enum(['BLOCKING', 'WARNING']);

export const checklistItemSchema = z.object({
  key: z.string().min(1),
  prompt: z.string().min(1),
  type: checklistItemTypeSchema,
  required: z.boolean(),
  failSeverity: failSeveritySchema,
  // Cites the source clause, e.g. "OHS Part 19 s.257" (Section 8.8: checklist drives
  // pass/fail, not free text or AI).
  regulatoryReference: z.string().min(1).optional(),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistTemplateSchema = z.object({
  id: uuidSchema,
  equipmentType: equipmentTypeSchema,
  version: z.number().int().positive(),
  isActive: z.boolean(),
  effectiveFrom: z.string().datetime(),
  items: z.array(checklistItemSchema).min(1),
  createdBy: uuidSchema,
  reviewedBy: uuidSchema.nullable(),
  createdAt: z.string().datetime(),
});

export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;

// Body for POST /api/v1/checklists. Server derives id, version, isActive, effectiveFrom,
// createdBy (from the validated token) and createdAt; never trust these from the client.
export const publishChecklistTemplateSchema = z.object({
  equipmentType: equipmentTypeSchema,
  items: z.array(checklistItemSchema).min(1),
  reviewedBy: uuidSchema.optional(),
});

export type PublishChecklistTemplate = z.infer<typeof publishChecklistTemplateSchema>;

// Query for GET /api/v1/checklists/active?type=FORKLIFT
export const activeChecklistQuerySchema = z.object({
  type: equipmentTypeSchema,
});

export type ActiveChecklistQuery = z.infer<typeof activeChecklistQuerySchema>;

// Response for GET /api/v1/checklists/:id/diff/:otherId. Items are matched by key: a key
// present in both templates with identical field values is unchanged and omitted from every
// list below.
export const checklistTemplateItemChangeSchema = z.object({
  key: z.string(),
  before: checklistItemSchema,
  after: checklistItemSchema,
});

export type ChecklistTemplateItemChange = z.infer<typeof checklistTemplateItemChangeSchema>;

export const checklistTemplateDiffSchema = z.object({
  from: checklistTemplateSchema,
  to: checklistTemplateSchema,
  added: z.array(checklistItemSchema),
  removed: z.array(checklistItemSchema),
  changed: z.array(checklistTemplateItemChangeSchema),
});

export type ChecklistTemplateDiff = z.infer<typeof checklistTemplateDiffSchema>;

// Write-side schemas for POST /equipment and PATCH /equipment/:id.
// manufacturerSpecsUrl is enforced as a URL here (DEV-24); the read schema stays
// lenient so a malformed value already in the DB does not break the equipment list.
// .strict() rejects any field not listed here with a 400. status and currentStatusSince
// are intentionally absent: a new record always starts AWAITING_INSPECTION (OHS s.257), and
// a client that sends status is told no, loudly, rather than having it silently dropped
// (threat model DEV-24, Threat 1).
export const createEquipmentSchema = z
  .object({
    assetTag: z.string().min(1),
    name: z.string().min(1),
    type: equipmentTypeSchema,
    make: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    serialNumber: z.string().min(1).nullable().optional(),
    location: z.string().min(1).nullable().optional(),
    manufacturerSpecsUrl: z.string().url().nullable().optional(),
  })
  .strict();

export type CreateEquipment = z.infer<typeof createEquipmentSchema>;

// Status transitions are excluded from PATCH; they go through the state machine (Sprint 2).
// assetTag and type are also excluded because changing them on an existing record would
// break the QR scan contract and violate inspection history linkage.
// .strict() turns this into a hard allowlist: a PATCH body carrying status (or any other
// field) is rejected with 400, so the readiness gate (OHS s.257) cannot be forced open by
// a permissive schema (threat model DEV-24, Threat 1). .strict() runs before .refine() so
// the field-set lock applies before the non-empty check.
export const patchEquipmentSchema = z
  .object({
    name: z.string().min(1).optional(),
    make: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    serialNumber: z.string().min(1).nullable().optional(),
    location: z.string().min(1).nullable().optional(),
    manufacturerSpecsUrl: z.string().url().nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

export type PatchEquipment = z.infer<typeof patchEquipmentSchema>;

export const inspectionResponseSchema = z.object({
  itemKey: z.string(),
  value: z.unknown(),
  passed: z.boolean(),
  notes: z.string().optional(),
  notesSource: z.enum(['TYPED', 'VOICE_TRANSCRIBED', 'VOICE_EDITED']).optional(),
});

export const submitInspectionSchema = z.object({
  equipmentId: uuidSchema,
  templateId: uuidSchema,
  responses: z.array(inspectionResponseSchema),
  // Operator attestation, not a signature. True only after the operator reviewed a summary
  // of their answers and confirmed. Identity comes from the validated token; tamper-evidence
  // is the audit chain (ADR 0007, ADR 0008). No HMAC.
  attested: z.literal(true),
});

export type InspectionResponse = z.infer<typeof inspectionResponseSchema>;
export type SubmitInspection = z.infer<typeof submitInspectionSchema>;

export const inspectionResultSchema = z.enum(['PASS', 'FAIL_WARNING', 'FAIL_BLOCKING']);

// Response for POST /api/v1/inspections. Server-derived fields only: result and
// templateVersion are never accepted from the client (ADR 0007, ADR 0008).
export const inspectionSchema = z.object({
  id: uuidSchema,
  equipmentId: uuidSchema,
  operatorId: uuidSchema,
  templateId: uuidSchema,
  templateVersion: z.number().int().positive(),
  result: inspectionResultSchema,
  submittedAt: z.string().datetime(),
});

export type Inspection = z.infer<typeof inspectionSchema>;

// Query for GET /api/v1/inspections?equipmentId=&operatorId=&from=&to=&limit=. All filters
// optional; from/to bound submittedAt (inclusive). limit caps the page size so the fleet
// drilldown history stays flat as an equipment's inspection count grows over time (DEV-37 NFR).
export const listInspectionsQuerySchema = z.object({
  equipmentId: uuidSchema.optional(),
  operatorId: uuidSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type ListInspectionsQuery = z.infer<typeof listInspectionsQuerySchema>;

// List/detail responses add the operator's display name: Inspection only stores operatorId,
// and the fleet grid (DEV-37) needs "who performed it" without a second round trip per row.
export const inspectionListItemSchema = inspectionSchema.extend({
  operatorDisplayName: z.string(),
});

export type InspectionListItem = z.infer<typeof inspectionListItemSchema>;

// A single checklist item's response, read back for the drilldown history (DEV-37). value stays
// z.unknown(): it is opaque per-item-type data (see inspectionResponseSchema), not re-validated
// on read. notes carries the voice transcript text when notesSource is VOICE_TRANSCRIBED or
// VOICE_EDITED (ADR: transcripts are stored as text, not re-fetched from the AI Service).
export const inspectionResponseRecordSchema = z.object({
  id: uuidSchema,
  itemKey: z.string(),
  value: z.unknown(),
  passed: z.boolean(),
  notes: z.string().nullable(),
  notesSource: z.enum(['TYPED', 'VOICE_TRANSCRIBED', 'VOICE_EDITED']).nullable(),
});

export type InspectionResponseRecord = z.infer<typeof inspectionResponseRecordSchema>;

export const inspectionDetailSchema = inspectionListItemSchema.extend({
  responses: z.array(inspectionResponseRecordSchema),
});

export type InspectionDetail = z.infer<typeof inspectionDetailSchema>;

// Extends the equipment contract with the fleet grid's "last inspection" summary (DEV-37). Kept
// separate from equipmentSchema (used by create/update/get-by-id) so those routes are unaffected;
// only GET /api/v1/equipment's list response uses this shape. Null fields mean the equipment has
// no inspection yet.
export const equipmentWithLastInspectionSchema = equipmentSchema.extend({
  lastInspectionAt: z.string().datetime().nullable(),
  lastInspectionResult: inspectionResultSchema.nullable(),
  lastInspectionOperatorDisplayName: z.string().nullable(),
});

export type EquipmentWithLastInspection = z.infer<typeof equipmentWithLastInspectionSchema>;

export const defectStatusSchema = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'IN_REPAIR',
  'RESOLVED',
  'REJECTED',
]);

export type DefectStatus = z.infer<typeof defectStatusSchema>;

// Response for defect endpoints. Every lifecycle field (status, openedAt, resolvedAt,
// resolvedBy, returnToServiceApprovedBy) is server-owned: clients move a defect only through
// the transition endpoints, never by sending these values. Defects are a mutable workflow
// table, so they sit outside the append-only inspection record (ADR 0007, ADR 0008); the
// linked Inspection stays immutable.
export const defectSchema = z.object({
  id: uuidSchema,
  inspectionId: uuidSchema,
  equipmentId: uuidSchema,
  itemKey: z.string().min(1),
  severity: failSeveritySchema,
  description: z.string(),
  photoIds: z.array(uuidSchema),
  status: defectStatusSchema,
  openedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: uuidSchema.nullable(),
  resolutionNotes: z.string().nullable(),
  returnToServiceApprovedBy: uuidSchema.nullable(),
});

export type Defect = z.infer<typeof defectSchema>;

// Body for POST /api/v1/defects/:id/resolve. resolutionNotes is required: the log book
// expects a record of what corrected the defect (Part 6). Only Supervisor/Manager may resolve.
export const resolveDefectSchema = z.object({
  resolutionNotes: z.string().min(1),
});

export type ResolveDefect = z.infer<typeof resolveDefectSchema>;

// Body for POST /api/v1/defects/:id/reject. reason records why the defect was dismissed (for
// example a misread gauge). It is stored in resolution_notes; the table has no separate reject
// column, so reject reuses the resolved_* fields to hold who dismissed it and when.
export const rejectDefectSchema = z.object({
  reason: z.string().min(1),
});

export type RejectDefect = z.infer<typeof rejectDefectSchema>;

// Query for GET /api/v1/defects?equipmentId=...&status=OPEN. Both filters are optional; the
// PWA lockout tag reads by equipmentId + status=OPEN, the dashboard inbox by status.
export const listDefectsQuerySchema = z.object({
  equipmentId: uuidSchema.optional(),
  status: defectStatusSchema.optional(),
});

export type ListDefectsQuery = z.infer<typeof listDefectsQuerySchema>;

// Action types the audit chain accepts (DEV-23 / ADR 0008). Only INSPECTION_SUBMITTED has a
// producer today (the core-api outbox poller); the other three are accepted now so the events
// that emit them later (defect handling, the equipment status state machine) do not need an
// audit_db migration when they land.
export const auditActionSchema = z.enum([
  'INSPECTION_SUBMITTED',
  'DEFECT_OPENED',
  'DEFECT_RESOLVED',
  'EQUIPMENT_STATUS_CHANGED',
]);

export type AuditAction = z.infer<typeof auditActionSchema>;

// Body for POST /api/v1/events on the Audit Service (internal, core-api outbox poller only).
// payloadSummary is restricted to flat scalar values: the audit log carries ids, enums, and
// hashes, never free text or nested structures (no PII, ADR 0008 "a hash is not PII").
export const auditEventIngestSchema = z.object({
  sourceEventId: uuidSchema,
  action: auditActionSchema,
  actorId: uuidSchema,
  resourceType: z.string().min(1),
  resourceId: uuidSchema,
  occurredAt: z.string().datetime(),
  payloadSummary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type AuditEventIngest = z.infer<typeof auditEventIngestSchema>;

export const auditEventIngestResponseSchema = z.object({
  id: uuidSchema,
  deduped: z.boolean(),
});

export type AuditEventIngestResponse = z.infer<typeof auditEventIngestResponseSchema>;

// Image content types the Media Service accepts for a photo upload (DEV-32). The set is
// enforced by sniffing the file's leading bytes, not the client-declared Content-Type, so a
// spoofed header cannot smuggle a non-image through (see services/media image-type sniffing).
export const photoContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

export type PhotoContentType = z.infer<typeof photoContentTypeSchema>;

// Response for POST /api/v1/media/upload (Media Service, DEV-32). photoId is the stable
// reference the operator PWA stores in an InspectionResponse.photo_ids array at submit time
// (DEV-18); it is also the blob name inside the container, so the id alone locates the object.
// The Media Service writes no core_db row: the association between a photo and an inspection
// response lives in core_db and is created by the submit endpoint, not here. sha256 is the
// content hash recorded on the blob for later integrity checks (report/audit export path).
export const mediaUploadResponseSchema = z.object({
  photoId: uuidSchema,
  container: z.string().min(1),
  blobName: z.string().min(1),
  contentType: photoContentTypeSchema,
  size: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});

export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>;

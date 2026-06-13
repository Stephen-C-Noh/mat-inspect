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

export const checklistItemTypeSchema = z.enum([
  'BOOLEAN',
  'BOOLEAN_PHOTO_ON_FAIL',
  'MEASUREMENT',
  'TEXT',
  'SIGNATURE',
]);

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

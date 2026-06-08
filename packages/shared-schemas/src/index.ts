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
  manufacturerSpecsUrl: z.string().url().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Equipment = z.infer<typeof equipmentSchema>;

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
  signatureHmac: z.string(),
});

export type InspectionResponse = z.infer<typeof inspectionResponseSchema>;
export type SubmitInspection = z.infer<typeof submitInspectionSchema>;

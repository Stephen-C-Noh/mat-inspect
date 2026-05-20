import { z } from 'zod';

export const uuidSchema = z.string().uuid();

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

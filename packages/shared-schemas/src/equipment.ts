import { z } from 'zod';

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
  assetTag: z.string(),
  name: z.string(),
  type: equipmentTypeSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  manufacturerSpecsUrl: z.string().nullable().optional(),
  status: equipmentStatusSchema,
  location: z.string().nullable(),
  currentStatusSince: z.string(),
});

export type Equipment = z.infer<typeof equipmentSchema>;

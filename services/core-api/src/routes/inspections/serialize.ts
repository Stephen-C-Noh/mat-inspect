import type { Inspection } from '@mat-inspect/shared-schemas';
import type { inspections } from '../../db/index.js';

type InspectionRow = typeof inspections.$inferSelect;

// Postgres timestamp columns arrive as Date objects; the inspectionSchema response is JSON,
// so dates become ISO strings.
export const serializeInspection = (row: InspectionRow): Inspection => ({
  id: row.id,
  equipmentId: row.equipmentId,
  operatorId: row.operatorId,
  templateId: row.templateId,
  templateVersion: row.templateVersion,
  result: row.result,
  submittedAt: row.submittedAt.toISOString(),
});

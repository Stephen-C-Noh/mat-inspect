import type {
  Inspection,
  InspectionListItem,
  InspectionDetail,
  InspectionResponseRecord,
} from '@mat-inspect/shared-schemas';
import type { inspections, inspectionResponses } from '../../db/index.js';

type InspectionRow = typeof inspections.$inferSelect;
type InspectionResponseRow = typeof inspectionResponses.$inferSelect;

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

export const serializeInspectionListItem = (
  row: InspectionRow,
  operatorDisplayName: string,
): InspectionListItem => ({
  ...serializeInspection(row),
  operatorDisplayName,
});

export const serializeInspectionResponse = (
  row: InspectionResponseRow,
): InspectionResponseRecord => ({
  id: row.id,
  itemKey: row.itemKey,
  value: row.value,
  passed: row.passed,
  notes: row.notes,
  notesSource: row.notesSource,
  photoIds: row.photoIds,
  defectCategory: row.defectCategory,
});

export const serializeInspectionDetail = (
  row: InspectionRow,
  operatorDisplayName: string,
  responses: InspectionResponseRow[],
): InspectionDetail => ({
  ...serializeInspectionListItem(row, operatorDisplayName),
  responses: responses.map(serializeInspectionResponse),
});

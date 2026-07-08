import type { Defect } from '@mat-inspect/shared-schemas';
import type { defects } from '../../db/index.js';

type DefectRow = typeof defects.$inferSelect;

// Maps a Drizzle defect row to the shared client contract. Postgres timestamp columns arrive
// as Date objects; the defectSchema response is JSON, so dates become ISO strings and unset
// nullable columns stay null (never undefined) to match the response schema (DEV-27).
export const serializeDefect = (row: DefectRow): Defect => ({
  id: row.id,
  inspectionId: row.inspectionId,
  equipmentId: row.equipmentId,
  itemKey: row.itemKey,
  severity: row.severity,
  description: row.description,
  photoIds: row.photoIds,
  status: row.status,
  openedAt: row.openedAt.toISOString(),
  resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  resolvedBy: row.resolvedBy,
  resolutionNotes: row.resolutionNotes,
  returnToServiceApprovedBy: row.returnToServiceApprovedBy,
});

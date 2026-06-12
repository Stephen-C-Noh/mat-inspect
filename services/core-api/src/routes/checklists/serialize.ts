import type { ChecklistTemplate } from '@mat-inspect/shared-schemas';
import type { checklistTemplates } from '../../db/index.js';

type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;

// Maps a Drizzle checklist_templates row to the shared client contract. Postgres timestamp
// columns arrive as Date objects; the checklistTemplateSchema response is JSON, so dates
// become ISO strings.
export const serializeChecklistTemplate = (row: ChecklistTemplateRow): ChecklistTemplate => ({
  id: row.id,
  equipmentType: row.equipmentType,
  version: row.version,
  isActive: row.isActive,
  effectiveFrom: row.effectiveFrom.toISOString(),
  items: row.items,
  createdBy: row.createdBy,
  reviewedBy: row.reviewedBy,
  createdAt: row.createdAt.toISOString(),
});

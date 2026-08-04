import { eq } from 'drizzle-orm';
import { db, checklistTemplates, inspectionResponses, inspections, users } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';

type InspectionRow = typeof inspections.$inferSelect;
type InspectionResponseRow = typeof inspectionResponses.$inferSelect;

export type LoadedInspection = {
  inspection: InspectionRow;
  operatorDisplayName: string;
  responses: InspectionResponseRow[];
};

// Loads an inspection with its operator's display name and its responses, ordered to match the
// pinned checklist template's item order. inspection_responses carries no sequence column of its
// own, so the template's items array (fixed at submit time via templateVersion) is the source of
// truth for display order in the drilldown (DEV-37).
export const loadInspectionDetail = async (id: string): Promise<LoadedInspection> => {
  const [row] = await db
    .select({ inspection: inspections, operatorDisplayName: users.displayName })
    .from(inspections)
    .innerJoin(users, eq(users.id, inspections.operatorId))
    .where(eq(inspections.id, id))
    .limit(1);

  if (!row) {
    throw httpError(404, 'INSPECTION_NOT_FOUND', `Inspection ${id} not found`);
  }

  const [template] = await db
    .select({ items: checklistTemplates.items })
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, row.inspection.templateId))
    .limit(1);

  const responseRows = await db
    .select()
    .from(inspectionResponses)
    .where(eq(inspectionResponses.inspectionId, id));

  const order = new Map((template?.items ?? []).map((item, index) => [item.key, index]));
  const sortedResponses = [...responseRows].sort(
    (a, b) =>
      (order.get(a.itemKey) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.itemKey) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    inspection: row.inspection,
    operatorDisplayName: row.operatorDisplayName,
    responses: sortedResponses,
  };
};

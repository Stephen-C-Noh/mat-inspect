import type { ChecklistItemRecord } from '@mat-inspect/db';
import type { InspectionResponse } from '@mat-inspect/shared-schemas';

export type BlockingDefectInput = {
  itemKey: string;
  severity: 'BLOCKING';
  description: string;
};

// Builds the single aggregate Defect for a FAIL_BLOCKING inspection (DEV-20, ADR 0006). A
// submit can fail several BLOCKING items, but exactly one Defect is opened per inspection:
// item_key is the first failing BLOCKING item, and description lists every failing BLOCKING
// item (prompt plus operator note) so no detail is lost when the rows are collapsed into one.
// Returns null when no BLOCKING item failed, so the caller opens no defect. deriveInspectionResult
// has already rejected unknown item keys before this runs, so every key resolves in the map.
export const buildBlockingDefect = (
  items: ChecklistItemRecord[],
  responses: InspectionResponse[],
): BlockingDefectInput | null => {
  const itemByKey = new Map(items.map((item) => [item.key, item]));

  const blockingFailures = responses.filter(
    (response) => !response.passed && itemByKey.get(response.itemKey)?.failSeverity === 'BLOCKING',
  );

  if (blockingFailures.length === 0) return null;

  const description = blockingFailures
    .map((response) => {
      const prompt = itemByKey.get(response.itemKey)?.prompt ?? response.itemKey;
      const note = response.notes?.trim();
      return note ? `${prompt}: ${note}` : prompt;
    })
    .join('; ');

  return {
    itemKey: blockingFailures[0]!.itemKey,
    severity: 'BLOCKING',
    description,
  };
};

import type { ChecklistItemRecord } from '@mat-inspect/db';
import type { InspectionResponse } from '@mat-inspect/shared-schemas';
import type { InspectionResult } from '@mat-inspect/shared-types';
import { httpError } from '../../lib/http-error.js';

// Server-side result derivation (CLAUDE.md, OHS s.257): a client-sent result is always
// ignored. BLOCKING short-circuits because nothing can outrank it; a WARNING keeps
// scanning in case a later response is BLOCKING.
export const deriveInspectionResult = (
  items: ChecklistItemRecord[],
  responses: InspectionResponse[],
): InspectionResult => {
  const severityByKey = new Map(items.map((item) => [item.key, item.failSeverity]));

  // A competent human operator must complete the inspection (OHS s.257). Without this guard
  // an empty or partial responses array derives PASS, recording an inspection that was never
  // performed. Every required item in the pinned template version must be answered.
  const answeredKeys = new Set(responses.map((response) => response.itemKey));
  const missing = items.filter((item) => item.required && !answeredKeys.has(item.key));
  if (missing.length > 0) {
    throw httpError(
      400,
      'INSPECTION_MISSING_REQUIRED_ITEM',
      `Missing responses for required checklist item(s): ${missing.map((item) => item.key).join(', ')}`,
    );
  }

  let worst: InspectionResult = 'PASS';
  for (const response of responses) {
    if (response.passed) continue;

    const severity = severityByKey.get(response.itemKey);
    if (!severity) {
      throw httpError(
        400,
        'INSPECTION_UNKNOWN_ITEM_KEY',
        `Response item key "${response.itemKey}" is not in template version's checklist`,
      );
    }

    if (severity === 'BLOCKING') return 'FAIL_BLOCKING';
    worst = 'FAIL_WARNING';
  }
  return worst;
};

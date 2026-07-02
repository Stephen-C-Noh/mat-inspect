import type { ChecklistItemRecord } from '@mat-inspect/db';
import type { InspectionResponse } from '@mat-inspect/shared-schemas';

// Returns the human-readable prompts of the checklist items that failed with BLOCKING severity,
// for the failed-inspection email body (DEV-21 / DEV-81). Result derivation (deriveInspectionResult)
// runs first and has already validated the responses against the pinned template version, so an
// unknown item key cannot reach here. A response with passed === false whose item is BLOCKING is a
// blocking defect; passing responses and failed WARNING items are not.
export const collectBlockingDefectDescriptions = (
  items: ChecklistItemRecord[],
  responses: InspectionResponse[],
): string[] => {
  const blockingPromptByKey = new Map(
    items
      .filter((item) => item.failSeverity === 'BLOCKING')
      .map((item) => [item.key, item.prompt] as const),
  );

  const descriptions: string[] = [];
  for (const response of responses) {
    if (response.passed) continue;
    const prompt = blockingPromptByKey.get(response.itemKey);
    if (prompt !== undefined) descriptions.push(prompt);
  }
  return descriptions;
};

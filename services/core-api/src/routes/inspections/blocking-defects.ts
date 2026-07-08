import type { ChecklistItemRecord } from '@mat-inspect/db';
import type { InspectionResponse } from '@mat-inspect/shared-schemas';

export type BlockingFailure = {
  itemKey: string;
  prompt: string;
  note: string | null;
};

// Shared primitive for the two blocking-failure consumers: the failed-inspection email body
// (collectBlockingDefectDescriptions, DEV-21 / DEV-81) and the auto-created Defect
// (buildBlockingDefect, DEV-20). deriveInspectionResult runs first and has already validated the
// responses against the pinned template version, so an unknown item key cannot reach here. A
// response with passed === false whose item is BLOCKING is a blocking failure; passing responses
// and failed WARNING items are not. Response order is preserved so both consumers read the items
// in the order the operator answered.
export const blockingFailures = (
  items: ChecklistItemRecord[],
  responses: InspectionResponse[],
): BlockingFailure[] => {
  const itemByKey = new Map(items.map((item) => [item.key, item] as const));

  const failures: BlockingFailure[] = [];
  for (const response of responses) {
    if (response.passed) continue;
    const item = itemByKey.get(response.itemKey);
    if (item?.failSeverity !== 'BLOCKING') continue;
    const note = response.notes?.trim();
    failures.push({ itemKey: item.key, prompt: item.prompt, note: note ? note : null });
  }
  return failures;
};

// Human-readable prompts of the blocking-failed items, for the failed-inspection email body
// (DEV-21 / DEV-81).
export const collectBlockingDefectDescriptions = (
  items: ChecklistItemRecord[],
  responses: InspectionResponse[],
): string[] => blockingFailures(items, responses).map((failure) => failure.prompt);

export type BlockingDefectInput = {
  itemKey: string;
  severity: 'BLOCKING';
  description: string;
};

// The single aggregate Defect for a FAIL_BLOCKING inspection (DEV-20, ADR 0006). A submit can
// fail several BLOCKING items, but exactly one Defect is opened per inspection: item_key is the
// first failing BLOCKING item, and description lists every failing BLOCKING item (prompt plus
// operator note) so no detail is lost when the rows are collapsed into one. Returns null when no
// BLOCKING item failed, so the caller opens no defect.
export const buildBlockingDefect = (
  items: ChecklistItemRecord[],
  responses: InspectionResponse[],
): BlockingDefectInput | null => {
  const failures = blockingFailures(items, responses);
  if (failures.length === 0) return null;

  const description = failures
    .map((failure) => (failure.note ? `${failure.prompt}: ${failure.note}` : failure.prompt))
    .join('; ');

  return { itemKey: failures[0]!.itemKey, severity: 'BLOCKING', description };
};

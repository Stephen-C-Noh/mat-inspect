import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { InspectionResponse, SubmitInspection } from '@mat-inspect/shared-schemas';
import type { ChecklistAnswers } from './checklist-answers';
import type { ItemNote } from './voice-notes';

export type FailedItem = { itemKey: string; prompt: string };

// The items the operator must document: failed BOOLEAN items in template order. A TEXT item has
// no fail state, so it never appears here (checklist-answers failedCount).
export const collectFailedItems = (
  items: ChecklistItem[],
  answers: ChecklistAnswers,
): FailedItem[] =>
  items
    .filter((item) => {
      const answer = answers[item.key];
      return answer?.kind === 'BOOLEAN' && !answer.passed;
    })
    .map((item) => ({ itemKey: item.key, prompt: item.prompt }));

// Only a BOOLEAN_PHOTO_ON_FAIL item requires evidence on a fail (DEV-120); a plain BOOLEAN fail
// never does. Screens do not call this directly: the checklist screen's submit gate and the review
// screen's redundant safety-net gate both go through failuresDocumented below, so the two can never
// drift out of sync. This stays a named function because it is what DEV-120's scoping rule is, and
// its own tests pin that rule independently of the gate that consumes it.
export const photoRequiredFailures = (
  items: ChecklistItem[],
  answers: ChecklistAnswers,
): FailedItem[] =>
  collectFailedItems(
    items.filter((item) => item.type === 'BOOLEAN_PHOTO_ON_FAIL'),
    answers,
  );

export const failuresDocumented = (
  items: ChecklistItem[],
  answers: ChecklistAnswers,
  photoIds: Record<string, string[]>,
): boolean =>
  photoRequiredFailures(items, answers).every((item) => (photoIds[item.itemKey]?.length ?? 0) > 0);

type BuildParams = {
  equipmentId: string;
  templateId: string;
  items: ChecklistItem[];
  answers: ChecklistAnswers;
  notes: Record<string, ItemNote>;
  photoIds: Record<string, string[]>;
  // The operator's explicit confirm, taken on the review screen after seeing a summary of their
  // answers (ADR 0007). Passed in rather than hardcoded so no code path can produce an attested
  // payload without one.
  attested: boolean;
};

// Maps the operator's answers to the POST /api/v1/inspections contract (ADR 0007, 0008). The
// server derives the result and ignores any client-sent result, so this only reports the raw
// per-item answers plus the attestation. Every answered item becomes one response; a BOOLEAN
// answer carries its pass/fail as both value and passed, matching the round-trip-stable jsonb
// value the audit chain re-reads (shared-schemas inspectionResponseValueSchema).
//
// notes and photoIds are sent as they stand in the draft for whatever the current answer is,
// with no pass/fail filtering here: the checklist screen resets an item's note and photo the
// moment its pass/fail value changes (DEV-134), so a document captured under a since-changed
// answer can never reach this function in the first place. That is what keeps "left fork cracked"
// from being sealed onto an immutable PASS row (ADR 0008), not a check in this payload builder.
export const buildSubmitPayload = (params: BuildParams): SubmitInspection => {
  // Fail loudly instead of sending attested: false. The server contract only accepts true
  // (shared-schemas attested: z.literal(true)), so an unattested submit is a caller bug: some
  // screen tried to POST without routing the operator through the review-and-confirm step.
  if (!params.attested) {
    throw new Error('Cannot build an inspection payload without the operator attestation');
  }

  const responses: InspectionResponse[] = [];

  for (const item of params.items) {
    const answer = params.answers[item.key];
    if (!answer) continue;

    if (answer.kind === 'BOOLEAN') {
      const note = params.notes[item.key];
      const trimmedNotes = note ? note.notes.trim() : '';

      responses.push({
        itemKey: item.key,
        value: answer.passed,
        passed: answer.passed,
        ...(note && trimmedNotes ? { notes: trimmedNotes, notesSource: note.notesSource } : {}),
        photoIds: params.photoIds[item.key] ?? [],
      });
    } else {
      // A TEXT item has no pass/fail state (checklist-answers failedCount); the typed string is
      // the response value and it always passes. Abnormal readings go in this free text, not a
      // structured numeric field (FRS), which keeps value a jsonb-round-trip-stable string.
      responses.push({ itemKey: item.key, value: answer.value, passed: true, photoIds: [] });
    }
  }

  return {
    equipmentId: params.equipmentId,
    templateId: params.templateId,
    attested: true,
    responses,
  };
};

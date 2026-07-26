import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { InspectionResponse, SubmitInspection } from '@mat-inspect/shared-schemas';
import type { ChecklistAnswers } from './checklist-answers';
import type { NotesSource } from './voice-notes';

// What the failure-documentation screen captured for one failed item: the defect note (with the
// source that decides its notesSource) and any uploaded evidence photo references (ADR 0023).
export type FailureDoc = {
  notes: string;
  notesSource: NotesSource;
  photoIds: string[];
};

// Keyed by checklist item key.
export type FailureDocs = Record<string, FailureDoc>;

export type FailedItem = { itemKey: string; prompt: string };

// The items the operator must document on the failure screen: failed BOOLEAN items in template
// order. A TEXT item has no fail state, so it never appears here (checklist-answers failedCount).
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

type BuildParams = {
  equipmentId: string;
  templateId: string;
  items: ChecklistItem[];
  answers: ChecklistAnswers;
  inlineNotes: Record<string, string>;
  failureDocs?: FailureDocs;
};

// Maps the operator's answers to the POST /api/v1/inspections contract (ADR 0007, 0008). The
// server derives the result and ignores any client-sent result, so this only reports the raw
// per-item answers plus the attestation. Every answered item becomes one response; a BOOLEAN
// answer carries its pass/fail as both value and passed, matching the round-trip-stable jsonb
// value the audit chain re-reads (shared-schemas inspectionResponseValueSchema).
export const buildSubmitPayload = (params: BuildParams): SubmitInspection => {
  const responses: InspectionResponse[] = [];

  for (const item of params.items) {
    const answer = params.answers[item.key];
    if (!answer) continue;

    if (answer.kind === 'BOOLEAN') {
      // A documented failure takes precedence: it carries the operator's reviewed defect note
      // (which may be voice-sourced) and the evidence photo references. Absent one, fall back to
      // the plain inline note typed on the checklist card, which is always TYPED.
      const doc = params.failureDocs?.[item.key];
      const docNote = doc?.notes.trim();
      const inlineNote = params.inlineNotes[item.key]?.trim();

      const note = doc && docNote ? { notes: docNote, notesSource: doc.notesSource } : undefined;
      const fallbackNote = inlineNote
        ? { notes: inlineNote, notesSource: 'TYPED' as NotesSource }
        : undefined;

      responses.push({
        itemKey: item.key,
        value: answer.passed,
        passed: answer.passed,
        ...(note ?? fallbackNote ?? {}),
        photoIds: doc?.photoIds ?? [],
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

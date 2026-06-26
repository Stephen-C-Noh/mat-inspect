import type { ChecklistItem } from '@mat-inspect/shared-types';

// The render layer supports three item types (DEV-16): BOOLEAN, BOOLEAN_PHOTO_ON_FAIL
// (same toggle as BOOLEAN; photo capture is Sprint 3 / DEV-33), and TEXT. There is no
// SIGNATURE or MEASUREMENT type: a drawn signature is rejected by ADR 0007, and abnormal
// readings go in free-text notes, not structured numeric data (FRS).
export type ChecklistAnswer =
  | { kind: 'BOOLEAN'; passed: boolean }
  | { kind: 'TEXT'; value: string };

export type ChecklistAnswers = Record<string, ChecklistAnswer>;

export const isItemAnswered = (
  item: ChecklistItem,
  answer: ChecklistAnswer | undefined,
): boolean => {
  if (!answer) return false;
  switch (answer.kind) {
    case 'BOOLEAN':
      return true;
    case 'TEXT':
      return answer.value.trim().length > 0;
  }
};

export const requiredItemsAnswered = (items: ChecklistItem[], answers: ChecklistAnswers): boolean =>
  items.filter((item) => item.required).every((item) => isItemAnswered(item, answers[item.key]));

export const answeredCount = (items: ChecklistItem[], answers: ChecklistAnswers): number =>
  items.filter((item) => isItemAnswered(item, answers[item.key])).length;

// Drives the submit button label ("Proceed with (N) Failures" vs "Submit Inspection").
// A failure is a boolean item explicitly marked fail; TEXT items have no pass/fail state.
export const failedCount = (items: ChecklistItem[], answers: ChecklistAnswers): number =>
  items.filter((item) => {
    const answer = answers[item.key];
    return answer?.kind === 'BOOLEAN' && !answer.passed;
  }).length;

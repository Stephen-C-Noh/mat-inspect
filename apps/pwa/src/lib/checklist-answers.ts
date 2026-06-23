import type { ChecklistItem } from '@mat-inspect/shared-types';

export type ChecklistAnswer =
  | { kind: 'BOOLEAN'; passed: boolean }
  | { kind: 'MEASUREMENT'; value: number }
  | { kind: 'TEXT'; value: string }
  | { kind: 'SIGNATURE'; signed: boolean };

export type ChecklistAnswers = Record<string, ChecklistAnswer>;

// BOOLEAN_PHOTO_ON_FAIL renders the same toggle as BOOLEAN; photo capture is Sprint 3.
export const isItemAnswered = (
  item: ChecklistItem,
  answer: ChecklistAnswer | undefined,
): boolean => {
  if (!answer) return false;
  switch (answer.kind) {
    case 'BOOLEAN':
      return true;
    case 'MEASUREMENT':
      return !Number.isNaN(answer.value);
    case 'TEXT':
      return answer.value.trim().length > 0;
    case 'SIGNATURE':
      return answer.signed;
  }
};

export const requiredItemsAnswered = (items: ChecklistItem[], answers: ChecklistAnswers): boolean =>
  items.filter((item) => item.required).every((item) => isItemAnswered(item, answers[item.key]));

export const answeredCount = (items: ChecklistItem[], answers: ChecklistAnswers): number =>
  items.filter((item) => isItemAnswered(item, answers[item.key])).length;

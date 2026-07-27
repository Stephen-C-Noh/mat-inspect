import type { AccountInfo } from '@azure/msal-browser';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import { answeredCount, failedCount, type ChecklistAnswers } from './checklist-answers';

// The counts the operator is shown before confirming, per ADR 0007: "You answered 12 items.
// 1 failed." Derived from the same helpers the checklist screen uses for its progress card, so
// the review screen can never disagree with the screen the operator just left.
export type AttestationSummary = {
  answered: number;
  total: number;
  failed: number;
};

export const attestationSummary = (
  items: ChecklistItem[],
  answers: ChecklistAnswers,
): AttestationSummary => ({
  answered: answeredCount(items, answers),
  total: items.length,
  failed: failedCount(items, answers),
});

// Who the review screen says the inspection is being submitted as. Reads the signed-in MSAL
// account only: the operator identity on the record comes from the validated token server-side
// (DEV-124), so a typed or stored name here could contradict it.
export const operatorDisplayName = (account: AccountInfo): string =>
  account.name ?? account.username;

'use client';

import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import type { ChecklistItem, InspectionResult } from '@mat-inspect/shared-types';
import type { ChecklistAnswers } from '@/lib/checklist-answers';

// An in-progress inspection carried across the client-side route change from the checklist screen
// to the failure-documentation screen. Next keeps this provider mounted (it sits in the root
// layout) while the operator navigates between /inspect and /checklist segments, so the answers
// survive that navigation. Nothing is submitted yet, so a hard refresh dropping the draft is
// acceptable (the operator re-answers); the POST only happens once, from a single screen.
export type InspectionDraft = {
  equipmentId: string;
  templateId: string;
  items: ChecklistItem[];
  answers: ChecklistAnswers;
  inlineNotes: Record<string, string>;
};

// One documented failure as the operator recorded it, kept for the confirmation screen so it can
// show what was actually submitted instead of a hardcoded placeholder.
export type SubmittedFailure = {
  prompt: string;
  notes: string;
  photoUrl: string | null;
};

// The result of the POST, handed to the confirmation screens so they render the real inspection
// id (the submission reference) and the real documented failures.
export type SubmissionResult = {
  equipmentId: string;
  inspectionId: string;
  result: InspectionResult;
  failures: SubmittedFailure[];
};

type InspectionDraftContextValue = {
  draft: InspectionDraft | null;
  setDraft: (draft: InspectionDraft) => void;
  clearDraft: () => void;
  result: SubmissionResult | null;
  setResult: (result: SubmissionResult) => void;
  clearResult: () => void;
};

const InspectionDraftContext = createContext<InspectionDraftContextValue | null>(null);

export const InspectionDraftProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [draft, setDraftState] = useState<InspectionDraft | null>(null);
  const [result, setResultState] = useState<SubmissionResult | null>(null);

  const value: InspectionDraftContextValue = {
    draft,
    setDraft: setDraftState,
    clearDraft: () => setDraftState(null),
    result,
    setResult: setResultState,
    clearResult: () => setResultState(null),
  };

  return (
    <InspectionDraftContext.Provider value={value}>{children}</InspectionDraftContext.Provider>
  );
};

export const useInspectionDraft = (): InspectionDraftContextValue => {
  const ctx = useContext(InspectionDraftContext);
  if (!ctx) {
    throw new Error('useInspectionDraft must be used within an InspectionDraftProvider');
  }
  return ctx;
};

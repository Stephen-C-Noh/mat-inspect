'use client';

import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import type { InspectionResult } from '@mat-inspect/shared-types';

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

// The in-progress draft used to live here in React state, which meant any full page load between
// the checklist screen and the POST discarded a completed inspection (DEV-125). It now lives in
// sessionStorage, read and written through lib/inspection-draft-storage, so there is one source of
// truth that survives a reload or an interactive token renewal. This provider carries only the
// submission result, which is short-lived by design: it exists between the POST returning and the
// confirmation screen rendering, and nothing is lost if a reload drops it.
type InspectionDraftContextValue = {
  result: SubmissionResult | null;
  setResult: (result: SubmissionResult) => void;
  clearResult: () => void;
};

const InspectionDraftContext = createContext<InspectionDraftContextValue | null>(null);

export const InspectionDraftProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [result, setResultState] = useState<SubmissionResult | null>(null);

  const value: InspectionDraftContextValue = {
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

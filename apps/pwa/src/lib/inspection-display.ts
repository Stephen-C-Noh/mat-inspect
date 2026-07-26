import type { InspectionResult } from '@mat-inspect/shared-types';

// Presentation for an inspection result, shared by the recent list, the history list, and the
// detail screen so the three surfaces read the same. Colours map to the existing design tokens
// (success / warning / destructive) already used on the checklist and submitted screens.
export const RESULT_DISPLAY: Record<
  InspectionResult,
  { label: string; badgeClass: string; borderClass: string }
> = {
  PASS: {
    label: 'Pass',
    badgeClass: 'bg-success text-success-foreground',
    borderClass: 'border-l-success',
  },
  FAIL_WARNING: {
    label: 'Warning',
    badgeClass: 'bg-warning text-warning-foreground',
    borderClass: 'border-l-warning',
  },
  FAIL_BLOCKING: {
    label: 'Blocking',
    badgeClass: 'bg-destructive text-destructive-foreground',
    borderClass: 'border-l-destructive',
  },
};

// A submittedAt ISO string rendered for the operator's locale. Compact form for list rows.
export const formatInspectionDate = (iso: string): string => {
  const date = new Date(iso);
  return (
    date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    date.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })
  );
};

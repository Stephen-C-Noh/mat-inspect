import type { FailSeverity } from '@mat-inspect/shared-types';
import type { ReactElement } from 'react';

type Props = { severity: FailSeverity };

// Icon + text, never color alone, so the BLOCKING/WARNING distinction survives grayscale
// displays and color-blind operators (Section 10.3). Satisfies the AC that a BLOCKING item
// is visibly distinct from a WARNING.
export const SeverityTag = ({ severity }: Props): ReactElement => {
  if (severity === 'BLOCKING') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">
        <span aria-hidden>⛔</span>
        BLOCKING
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
      <span aria-hidden>⚠</span>
      WARNING
    </span>
  );
};

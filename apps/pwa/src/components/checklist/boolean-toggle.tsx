'use client';

import type { ReactElement } from 'react';

type Props = {
  passed: boolean | undefined;
  onChange: (passed: boolean) => void;
};

// Fail on the left, Pass on the right, matching design 03. Large, full-width tap targets
// (glove-friendly, Section 10.1). The selected state changes the fill so status is not
// conveyed by position alone (Section 10.3).
export const BooleanToggle = ({ passed, onChange }: Props): ReactElement => (
  <div className="grid grid-cols-2 gap-3" role="group" aria-label="Status">
    <button
      type="button"
      onClick={() => onChange(false)}
      aria-pressed={passed === false}
      className={`rounded-xl py-4 text-base font-bold transition-colors ${
        passed === false ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'
      }`}
    >
      Fail
    </button>
    <button
      type="button"
      onClick={() => onChange(true)}
      aria-pressed={passed === true}
      className={`rounded-xl py-4 text-base font-bold transition-colors ${
        passed === true ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-500'
      }`}
    >
      Pass
    </button>
  </div>
);

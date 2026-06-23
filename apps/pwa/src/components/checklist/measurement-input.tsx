'use client';

import type { ReactElement } from 'react';

type Props = {
  value: number | undefined;
  onChange: (value: number) => void;
};

export const MeasurementInput = ({ value, onChange }: Props): ReactElement => (
  <input
    type="number"
    inputMode="decimal"
    value={value === undefined || Number.isNaN(value) ? '' : value}
    onChange={(event) => onChange(event.target.valueAsNumber)}
    placeholder="Enter measurement"
    className="w-full rounded-xl border border-slate-300 px-4 py-4 text-base focus:border-blue-500 focus:outline-none"
  />
);

'use client';

import type { ReactElement } from 'react';

type Props = {
  value: string | undefined;
  onChange: (value: string) => void;
};

export const TextResponseInput = ({ value, onChange }: Props): ReactElement => (
  <textarea
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value)}
    placeholder="Enter response..."
    rows={3}
    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none"
  />
);

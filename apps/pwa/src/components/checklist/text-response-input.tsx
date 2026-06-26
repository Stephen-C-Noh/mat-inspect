'use client';

import type { ReactElement } from 'react';

type Props = {
  value: string | undefined;
  onChange: (value: string) => void;
};

// Free-text response for TEXT items. Abnormal numeric readings are also captured here as
// notes rather than a structured numeric input (FRS; no MEASUREMENT type).
export const TextResponseInput = ({ value, onChange }: Props): ReactElement => (
  <textarea
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value)}
    placeholder="Enter response..."
    rows={3}
    className="w-full rounded-lg border border-input bg-muted px-4 py-3 text-base text-foreground focus:border-ring focus:outline-none"
  />
);

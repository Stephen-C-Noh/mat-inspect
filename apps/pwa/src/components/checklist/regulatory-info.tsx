'use client';

import { useState, type ReactElement } from 'react';

type Props = { reference: string };

// The (i) control next to each item in design 03. Tap-to-reveal rather than hover, since
// gloved operators on a touch screen cannot hover (Section 10.1).
export const RegulatoryInfo = ({ reference }: Props): ReactElement => {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Why this item matters"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm font-bold text-muted-foreground"
      >
        i
      </button>
      {open && <p className="mt-1 max-w-[10rem] text-xs text-muted-foreground">{reference}</p>}
    </div>
  );
};

import type { ReactElement } from 'react';

// Photo capture itself is Sprint 3 (Media Service). This is the prompt UI only.
export const PhotoRequiredPrompt = (): ReactElement => (
  <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
    <span aria-hidden>📷</span>
    Photo required for this fail (capture coming in a later sprint)
  </div>
);

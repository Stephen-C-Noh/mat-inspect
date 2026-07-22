import { AlertTriangle, Ban } from 'lucide-react';
import type { FailSeverity } from '@mat-inspect/shared-types';
import type { ReactElement } from 'react';

type Props = { severity: FailSeverity };

// Mirrors apps/pwa/src/components/checklist/severity-tag.tsx: icon + text, never color
// alone, so BLOCKING/WARNING stays legible in grayscale and for color-blind users.
export const DefectSeverityTag = ({ severity }: Props): ReactElement => {
  if (severity === 'BLOCKING') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground">
        <Ban className="size-3.5" aria-hidden />
        BLOCKING
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-warning px-2.5 py-1 text-xs font-bold text-warning-foreground">
      <AlertTriangle className="size-3.5" aria-hidden />
      WARNING
    </span>
  );
};

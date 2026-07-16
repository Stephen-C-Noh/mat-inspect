import type { DefectStatus } from '@mat-inspect/shared-types';
import type { ReactElement } from 'react';

type Props = { status: DefectStatus };

// Icon + text, never color alone (WCAG 2.1 AA), matching apps/pwa's SeverityTag pattern
// so status reads the same way across both apps.
const STATUS_CONFIG: Record<DefectStatus, { icon: string; label: string; classes: string }> = {
  OPEN: { icon: '\u{1F534}', label: 'OPEN', classes: 'bg-destructive text-destructive-foreground' },
  ACKNOWLEDGED: {
    icon: '\u{1F441}',
    label: 'ACKNOWLEDGED',
    classes: 'bg-warning text-warning-foreground',
  },
  IN_REPAIR: { icon: '\u{1F527}', label: 'IN REPAIR', classes: 'bg-accent text-accent-foreground' },
  RESOLVED: { icon: '✔', label: 'RESOLVED', classes: 'bg-success text-success-foreground' },
  REJECTED: { icon: '✖', label: 'REJECTED', classes: 'bg-muted text-muted-foreground' },
};

export const DefectStatusTag = ({ status }: Props): ReactElement => {
  const { icon, label, classes } = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${classes}`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
};

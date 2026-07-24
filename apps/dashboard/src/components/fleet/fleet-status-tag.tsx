import { Archive, Ban, CheckCircle, Clock } from 'lucide-react';
import type { EquipmentStatus } from '@mat-inspect/shared-types';
import type { ReactElement } from 'react';

type Props = { status: EquipmentStatus };

// The four real computed-readiness values (ADR 0006) only. Icon + text, never color alone
// (WCAG 2.1 AA), matching DefectStatusTag's pattern so status reads the same way across the
// dashboard. There is no "Caution"/"Offline" category: those aren't values this system computes.
const STATUS_CONFIG: Record<
  EquipmentStatus,
  { icon: typeof CheckCircle; label: string; classes: string }
> = {
  READY: { icon: CheckCircle, label: 'Ready', classes: 'bg-success text-success-foreground' },
  AWAITING_INSPECTION: {
    icon: Clock,
    label: 'Awaiting Inspection',
    classes: 'bg-warning text-warning-foreground',
  },
  OUT_OF_SERVICE: {
    icon: Ban,
    label: 'Out of Service',
    classes: 'bg-destructive text-destructive-foreground',
  },
  RETIRED: { icon: Archive, label: 'Retired', classes: 'bg-muted text-muted-foreground' },
};

export const FleetStatusTag = ({ status }: Props): ReactElement => {
  const { icon: Icon, label, classes } = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${classes}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
};

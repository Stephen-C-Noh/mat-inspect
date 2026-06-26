import type { ReactElement } from 'react';

type Props = { answered: number; total: number };

// "Inspection Progress N/total" card with a fill bar, per design 03.
export const InspectionProgressCard = ({ answered, total }: Props): ReactElement => {
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);

  return (
    <div className="rounded-sm bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-muted-foreground">Inspection Progress</span>
        <span className="text-2xl font-extrabold text-accent">
          {answered}/{total}
        </span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

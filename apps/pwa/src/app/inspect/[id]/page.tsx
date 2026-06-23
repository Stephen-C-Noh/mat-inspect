'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import type { Equipment } from '@mat-inspect/shared-schemas';
import { useEquipmentList } from '../../../hooks/use-equipment';
import { ChevronLeftIcon } from '../../../components/ui/icons';

// Stub for the inspection screen (Figma 03-forklift-inspection). The scan screen
// routes here once an asset tag resolves. It loads the target equipment so the
// handoff is verifiable, but the checklist flow itself lands in the inspection
// ticket (DEV-18/19/20). Keep it a stub: no responses, no submit, no state machine.

// Status pill colors, token-only. Mirrors the equipment list palette so an operator
// reads readiness the same way across screens.
const STATUS_THEME: Record<Equipment['status'], string> = {
  READY: 'bg-success/10 text-success',
  AWAITING_INSPECTION: 'bg-warning/10 text-warning',
  OUT_OF_SERVICE: 'bg-destructive/10 text-destructive',
  RETIRED: 'bg-muted text-muted-foreground',
};

export default function InspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: equipmentList, isLoading, error } = useEquipmentList();

  const equipment = equipmentList?.find((item) => item.id === id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col gap-6 bg-background px-4 py-5">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="flex size-9 items-center justify-center rounded-lg text-foreground hover:bg-muted"
      >
        <ChevronLeftIcon />
      </button>

      <h1 className="text-2xl font-bold text-foreground">Pre-Use Inspection</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Loading equipment...</p>}
      {error && <p className="text-sm text-destructive">Could not load equipment.</p>}
      {!isLoading && !error && !equipment && (
        <p className="text-sm text-destructive">No equipment found for this ID.</p>
      )}

      {equipment && (
        <section className="flex flex-col gap-3 rounded-sm border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="text-lg font-bold text-card-foreground">{equipment.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">{equipment.assetTag}</span>
            </div>
            <span
              className={`rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wide ${STATUS_THEME[equipment.status]}`}
            >
              {equipment.status.replaceAll('_', ' ')}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="Type" value={equipment.type.replaceAll('_', ' ')} />
            <Detail label="Location" value={equipment.location} />
            <Detail label="Make" value={equipment.make} />
            <Detail label="Model" value={equipment.model} />
          </dl>
        </section>
      )}

      <section className="flex flex-col items-center gap-2 rounded-sm border border-dashed border-border bg-muted px-4 py-8 text-center">
        <p className="font-semibold text-foreground">Inspection checklist coming next</p>
        <p className="text-sm text-muted-foreground">
          The checklist flow (Figma 03) lands in the inspection ticket. A competent operator
          completes the visual inspection here; the app never auto-passes (OHS s.257).
        </p>
      </section>
    </main>
  );
}

const Detail = ({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}): React.ReactElement => (
  <div className="flex flex-col">
    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="font-medium text-foreground">{value ?? '-'}</dd>
  </div>
);

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactElement } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import type { InspectionResult } from '@mat-inspect/shared-types';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '@/hooks/use-equipment';
import { useMyInspections } from '@/hooks/use-my-inspections';
import { RESULT_DISPLAY, formatInspectionDate } from '@/lib/inspection-display';

// Converts a date input (YYYY-MM-DD, empty when unset) to the ISO datetime bound core-api's
// from/to filters expect. from is the start of the day, to the end, both in UTC to line up with
// the stored submittedAt.
const dayStart = (d: string): string | undefined => (d ? `${d}T00:00:00.000Z` : undefined);
const dayEnd = (d: string): string | undefined => (d ? `${d}T23:59:59.999Z` : undefined);

function HistoryContent(): ReactElement {
  const router = useRouter();
  const { data: equipmentList } = useEquipmentList();

  const [equipmentId, setEquipmentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Result has no server filter (listInspectionsQuerySchema has none), so it is applied client-side
  // to the page core-api returns.
  const [result, setResult] = useState<'' | InspectionResult>('');

  const {
    data: inspections,
    isLoading,
    error,
  } = useMyInspections({
    equipmentId: equipmentId || undefined,
    from: dayStart(from),
    to: dayEnd(to),
  });

  const equipmentById = useMemo(
    () => new Map((equipmentList ?? []).map((e) => [e.id, e])),
    [equipmentList],
  );

  const rows = useMemo(
    () => (inspections ?? []).filter((i) => (result ? i.result === result : true)),
    [inspections, result],
  );

  return (
    <main className="min-h-screen bg-muted pb-10">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-sm p-1.5 hover:bg-primary-foreground/10 transition-colors"
          aria-label="Go back"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-sm font-extrabold uppercase tracking-wide">Inspection History</span>
      </header>

      <div className="mx-auto max-w-lg space-y-4 p-4">
        {/* Filters */}
        <div className="grid grid-cols-2 gap-3 rounded-sm border border-border bg-card p-3 shadow-card">
          <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Equipment
            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              className="rounded-sm border border-border bg-background px-2 py-2 text-sm text-foreground"
            >
              <option value="">All equipment</option>
              {(equipmentList ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.assetTag})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-sm border border-border bg-background px-2 py-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-sm border border-border bg-background px-2 py-2 text-sm text-foreground"
            />
          </label>

          <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Result
            <select
              value={result}
              onChange={(e) => setResult(e.target.value as '' | InspectionResult)}
              className="rounded-sm border border-border bg-background px-2 py-2 text-sm text-foreground"
            >
              <option value="">All results</option>
              <option value="PASS">Pass</option>
              <option value="FAIL_WARNING">Warning</option>
              <option value="FAIL_BLOCKING">Blocking</option>
            </select>
          </label>
        </div>

        {/* List */}
        {isLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading...</p>}
        {error && (
          <p className="p-8 text-center text-sm text-destructive">Could not load your history.</p>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">No inspections found.</p>
        )}

        <div className="space-y-2">
          {rows.map((inspection) => {
            const equipment = equipmentById.get(inspection.equipmentId);
            const display = RESULT_DISPLAY[inspection.result];
            return (
              <Link
                key={inspection.id}
                href={`/history/${inspection.id}`}
                className={`flex items-center justify-between gap-3 rounded-sm border border-l-4 border-border bg-card p-4 shadow-card hover:bg-muted transition-colors ${display.borderClass}`}
              >
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-foreground">
                    {equipment?.name ?? 'Equipment'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {equipment?.assetTag ? `${equipment.assetTag} · ` : ''}
                    {formatInspectionDate(inspection.submittedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-bold ${display.badgeClass}`}
                  >
                    {display.label}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}

export default function HistoryPage(): ReactElement {
  return (
    <AuthGuard>
      <HistoryContent />
    </AuthGuard>
  );
}

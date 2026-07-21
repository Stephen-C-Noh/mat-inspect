'use client';

import { useMemo, useState, type ReactElement } from 'react';
import type { Defect, Equipment } from '@mat-inspect/shared-schemas';
import type { DefectStatus } from '@mat-inspect/shared-types';
import { useDefects } from '@/hooks/use-defects';
import { useEquipment } from '@/hooks/use-equipment';
import { useAcknowledgeDefect } from '@/hooks/use-acknowledge-defect';
import { useStartRepairDefect } from '@/hooks/use-start-repair-defect';
import { useResolveDefect } from '@/hooks/use-resolve-defect';
import { useReturnToService } from '@/hooks/use-return-to-service';
import {
  isQueueOpen,
  isPendingApproval,
  findEquipment,
  formatDate,
  shortCode,
  categoryFor,
} from '@/lib/defect-queue';
import { DefectStatusTag } from './defect-status-tag';
import { DefectSeverityTag } from './defect-severity-tag';

const displayId = (id: string): string => shortCode('DEF', id);

const FILTERS: { label: string; status: DefectStatus | 'ALL' }[] = [
  { label: 'All', status: 'ALL' },
  { label: 'Open', status: 'OPEN' },
  { label: "Ack'd", status: 'ACKNOWLEDGED' },
  { label: 'In Repair', status: 'IN_REPAIR' },
];

type DetailPanelProps = {
  defect: Defect;
  equipment: Equipment | undefined;
  canReturnToService: boolean;
};

const DefectDetailPanel = ({
  defect,
  equipment,
  canReturnToService,
}: DetailPanelProps): ReactElement => {
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState('');

  const acknowledge = useAcknowledgeDefect();
  const startRepair = useStartRepairDefect();
  const resolve = useResolveDefect();
  const returnToService = useReturnToService();

  return (
    <div className="rounded-sm border border-border bg-card p-6 shadow-card">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-muted-foreground">{displayId(defect.id)}</span>
        <DefectStatusTag status={defect.status} />
        <DefectSeverityTag severity={defect.severity} />
      </div>

      <h2 className="mt-3 text-xl font-bold text-foreground">{defect.description}</h2>

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-sm bg-muted p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Equipment
          </p>
          <p className="text-sm text-foreground">
            {equipment?.name ?? defect.equipmentId}
            {equipment && <span className="text-muted-foreground"> · {equipment.assetTag}</span>}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Location
          </p>
          <p className="text-sm text-foreground">{equipment?.location ?? 'Unknown'}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Category
          </p>
          <p className="text-sm text-foreground">{categoryFor(defect.itemKey)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Inspection
          </p>
          <p className="text-sm text-foreground">
            {defect.inspectionId} · {formatDate(defect.openedAt)}
          </p>
        </div>
      </div>

      {defect.resolutionNotes && (
        <div className="mt-4 rounded-sm border border-success/30 bg-success/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-success">Resolution Notes</p>
          <p className="mt-1 text-sm text-foreground">{defect.resolutionNotes}</p>
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Actions
        </p>

        {defect.status === 'OPEN' && (
          <button
            type="button"
            onClick={() => acknowledge.mutate(defect.id)}
            disabled={acknowledge.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            Acknowledge
          </button>
        )}

        {defect.status === 'ACKNOWLEDGED' && (
          <button
            type="button"
            onClick={() => startRepair.mutate(defect.id)}
            disabled={startRepair.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            Start Repair
          </button>
        )}

        {defect.status === 'IN_REPAIR' && !resolving && (
          <button
            type="button"
            onClick={() => setResolving(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90"
          >
            Resolve
          </button>
        )}

        {defect.status === 'IN_REPAIR' && resolving && (
          <div className="flex flex-col gap-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Resolution notes (required)"
              className="w-full rounded-sm border border-border bg-card p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => resolve.mutate({ defectId: defect.id, resolutionNotes: notes })}
                disabled={resolve.isPending || notes.trim().length === 0}
                className="rounded-lg bg-success px-4 py-2 text-sm font-bold text-success-foreground hover:opacity-90 disabled:opacity-50"
              >
                Submit
              </button>
              <button
                type="button"
                onClick={() => setResolving(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {defect.status === 'RESOLVED' && defect.severity === 'BLOCKING' && (
          <button
            type="button"
            onClick={() => returnToService.mutate(defect.equipmentId)}
            disabled={!canReturnToService || returnToService.isPending}
            className="rounded-lg bg-success px-4 py-2 text-sm font-bold text-success-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40"
          >
            {defect.returnToServiceApprovedBy
              ? 'Return to Service Approved'
              : 'Approve Return to Service'}
          </button>
        )}

        {(defect.status === 'RESOLVED' && defect.severity === 'WARNING') ||
        defect.status === 'REJECTED' ? (
          <p className="text-sm text-muted-foreground">No further action needed.</p>
        ) : null}
      </div>
    </div>
  );
};

type DefectsTableProps = { initialDefectId?: string | null };

export const DefectsTable = ({ initialDefectId = null }: DefectsTableProps): ReactElement => {
  const {
    data: defects,
    isLoading: defectsLoading,
    isError: defectsError,
    refetch: refetchDefects,
  } = useDefects();
  const {
    data: equipmentList,
    isLoading: equipmentLoading,
    isError: equipmentError,
  } = useEquipment();
  const [statusFilter, setStatusFilter] = useState<DefectStatus | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(initialDefectId);

  // The queue only ever shows open failures: RESOLVED clears immediately unless the defect
  // is BLOCKING and still awaiting a return-to-service approval (ADR 0006's watermark).
  const visibleDefects = useMemo(() => (defects ?? []).filter(isQueueOpen), [defects]);

  const filteredDefects = useMemo(
    () =>
      statusFilter === 'ALL'
        ? visibleDefects
        : visibleDefects.filter((d) => d.status === statusFilter),
    [visibleDefects, statusFilter],
  );

  const equipmentCanReturnToService = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const equipment of equipmentList ?? []) {
      const equipmentDefects = visibleDefects.filter((d) => d.equipmentId === equipment.id);
      const hasOpenBlocking = equipmentDefects.some(
        (d) => d.severity === 'BLOCKING' && d.status !== 'RESOLVED',
      );
      const hasResolvedBlocking = equipmentDefects.some(isPendingApproval);
      result.set(equipment.id, hasResolvedBlocking && !hasOpenBlocking);
    }
    return result;
  }, [visibleDefects, equipmentList]);

  // A defect deep-linked from the Failure Queue (?id=), or one selected earlier, can leave the
  // open queue before this renders (resolved and returned to service, or rejected). Treat that
  // distinctly from "nothing selected yet": silently swapping in an unrelated defect could lead
  // a supervisor to act on the wrong equipment.
  const requestedDefectGone =
    selectedId !== null && !visibleDefects.some((d) => d.id === selectedId);

  const selectedDefect = requestedDefectGone
    ? null
    : (filteredDefects.find((d) => d.id === selectedId) ?? filteredDefects[0] ?? null);

  // Equipment gates the return-to-service action, so wait for both queries before rendering the
  // list. Equipment is a small, fast query (about 10 rows) and this is the /defects page, not the
  // always-visible dashboard, so the extra wait is acceptable here.
  if (defectsLoading || equipmentLoading) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Loading defects...</p>;
  }

  // A failed defect fetch is not an empty list: say so rather than showing "No defects".
  if (defectsError) {
    return (
      <div className="rounded-sm border border-destructive/40 bg-destructive/10 p-8 text-center shadow-card">
        <p className="text-sm font-bold text-destructive">Could not load defects</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The failure list is unavailable right now. This is not an empty queue.
        </p>
        <button
          type="button"
          onClick={() => refetchDefects()}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.4fr]">
      {equipmentError && (
        <div className="rounded-sm border border-warning/40 bg-warning/10 p-3 text-center text-xs text-warning lg:col-span-2">
          Equipment details are unavailable: names may show as IDs, and return-to-service actions
          are temporarily disabled.
        </div>
      )}

      {/* Left: list */}
      <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-bold text-foreground">Defects</h2>
          <span className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground">
            {visibleDefects.length} open
          </span>
        </div>

        <div className="flex gap-2 border-b border-border p-3">
          {FILTERS.map((f) => (
            <button
              key={f.status}
              type="button"
              onClick={() => setStatusFilter(f.status)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                statusFilter === f.status
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filteredDefects.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No defects matching this filter
          </p>
        ) : (
          <div className="divide-y divide-border">
            {filteredDefects.map((defect) => {
              const equipment = findEquipment(equipmentList, defect.equipmentId);
              const isSelected = selectedDefect?.id === defect.id;

              return (
                <button
                  key={defect.id}
                  type="button"
                  onClick={() => setSelectedId(defect.id)}
                  className={`block w-full p-4 text-left transition-colors ${
                    isSelected ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted-foreground">
                      {displayId(defect.id)}
                    </span>
                    <DefectStatusTag status={defect.status} />
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{defect.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {equipment?.name ?? defect.equipmentId} · {defect.inspectionId}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: detail */}
      <div>
        {selectedDefect ? (
          <DefectDetailPanel
            defect={selectedDefect}
            equipment={findEquipment(equipmentList, selectedDefect.equipmentId)}
            canReturnToService={
              equipmentCanReturnToService.get(selectedDefect.equipmentId) ?? false
            }
          />
        ) : requestedDefectGone ? (
          <div className="rounded-sm border border-border bg-card p-8 text-center shadow-card">
            <p className="text-sm font-bold text-foreground">
              This defect is no longer in the active queue
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              It may have been resolved and returned to service, or rejected.
            </p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90"
            >
              Back to queue
            </button>
          </div>
        ) : (
          <div className="rounded-sm border border-border bg-card p-8 text-center shadow-card">
            <p className="text-sm text-muted-foreground">Select a defect to view details.</p>
          </div>
        )}
      </div>
    </div>
  );
};

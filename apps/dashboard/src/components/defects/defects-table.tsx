'use client';

import { useMemo, useState, type ReactElement } from 'react';
import type { Defect } from '@mat-inspect/shared-schemas';
import { useDefects } from '@/hooks/use-defects';
import { useAcknowledgeDefect } from '@/hooks/use-acknowledge-defect';
import { useStartRepairDefect } from '@/hooks/use-start-repair-defect';
import { useResolveDefect } from '@/hooks/use-resolve-defect';
import { useReturnToService } from '@/hooks/use-return-to-service';
import { MOCK_EQUIPMENT } from '@/lib/mock-defects';
import { DefectStatusTag } from './defect-status-tag';

// MOCK_EQUIPMENT stands in for a real equipment lookup/join until DEV-20 merges and the
// defects response (or a paired equipment fetch) carries the equipment name directly.
const equipmentName = (equipmentId: string): string =>
  MOCK_EQUIPMENT.find((e) => e.id === equipmentId)?.name ?? equipmentId;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

type DefectRowProps = { defect: Defect };

const DefectRow = ({ defect }: DefectRowProps): ReactElement => {
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState('');

  const acknowledge = useAcknowledgeDefect();
  const startRepair = useStartRepairDefect();
  const resolve = useResolveDefect();

  return (
    <tr className="border-b border-border align-top">
      <td className="p-3 text-sm text-foreground">{defect.description}</td>
      <td className="p-3 text-sm text-muted-foreground">
        Inspection {defect.inspectionId} &middot; {formatDate(defect.openedAt)}
      </td>
      <td className="p-3">
        <DefectStatusTag status={defect.status} />
      </td>
      <td className="p-3">
        {defect.status === 'OPEN' && (
          <button
            type="button"
            onClick={() => acknowledge.mutate(defect.id)}
            disabled={acknowledge.isPending}
            className="rounded-sm bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            Acknowledge
          </button>
        )}

        {defect.status === 'ACKNOWLEDGED' && (
          <button
            type="button"
            onClick={() => startRepair.mutate(defect.id)}
            disabled={startRepair.isPending}
            className="rounded-sm bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            Start Repair
          </button>
        )}

        {defect.status === 'IN_REPAIR' && !resolving && (
          <button
            type="button"
            onClick={() => setResolving(true)}
            className="rounded-sm bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:bg-accent/90"
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
              className="w-full rounded-sm border border-border bg-card p-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => resolve.mutate({ defectId: defect.id, resolutionNotes: notes })}
                disabled={resolve.isPending || notes.trim().length === 0}
                className="rounded-sm bg-success px-3 py-1.5 text-xs font-bold text-success-foreground disabled:opacity-50"
              >
                Submit
              </button>
              <button
                type="button"
                onClick={() => setResolving(false)}
                className="rounded-sm border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
};

export const DefectsTable = (): ReactElement => {
  const { data: defects, isLoading } = useDefects();
  const returnToService = useReturnToService();

  const groups = useMemo(() => {
    const visible = (defects ?? []).filter((d) => d.status !== 'REJECTED');
    const byEquipment = new Map<string, Defect[]>();

    for (const defect of visible) {
      const list = byEquipment.get(defect.equipmentId) ?? [];
      list.push(defect);
      byEquipment.set(defect.equipmentId, list);
    }

    return [...byEquipment.entries()].map(([equipmentId, equipmentDefects]) => {
      const hasOpenBlocking = equipmentDefects.some(
        (d) => d.severity === 'BLOCKING' && d.status !== 'RESOLVED',
      );
      const hasResolvedBlocking = equipmentDefects.some(
        (d) => d.severity === 'BLOCKING' && d.status === 'RESOLVED',
      );

      return {
        equipmentId,
        defects: equipmentDefects,
        canReturnToService: hasResolvedBlocking && !hasOpenBlocking,
      };
    });
  }, [defects]);

  if (isLoading) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Loading defects...</p>;
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-sm border border-border bg-card p-8 text-center shadow-card">
        <p className="text-sm text-muted-foreground">No open defects.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div
          key={group.equipmentId}
          className="overflow-hidden rounded-sm border border-border bg-card shadow-card"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <h3 className="font-bold text-foreground">{equipmentName(group.equipmentId)}</h3>
            <button
              type="button"
              onClick={() => returnToService.mutate(group.equipmentId)}
              disabled={!group.canReturnToService || returnToService.isPending}
              className="rounded-sm bg-success px-3 py-1.5 text-xs font-bold text-success-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve Return to Service
            </button>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <th className="p-3">Defect</th>
                <th className="p-3">Reported</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {group.defects.map((defect) => (
                <DefectRow key={defect.id} defect={defect} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

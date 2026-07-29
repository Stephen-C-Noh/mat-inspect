'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { useDefects } from '@/hooks/use-defects';
import { useEquipment } from '@/hooks/use-equipment';
import {
  categoryFor,
  findEquipment,
  formatAge,
  isActive,
  isNewToday,
  isPendingApproval,
  isQueueOpen,
  shortCode,
} from '@/lib/defect-queue';
import { DefectStatusTag } from '@/components/defects/defect-status-tag';
import { DefectSeverityTag } from '@/components/defects/defect-severity-tag';

type QueueFilter = 'ALL' | 'UNACKNOWLEDGED' | 'ACTIVE' | 'PENDING_APPROVAL';

const FILTERS: { label: string; value: QueueFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Unacknowledged', value: 'UNACKNOWLEDGED' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Pending Approval', value: 'PENDING_APPROVAL' },
];

const syncedLabel = (dataUpdatedAt: number): string => {
  if (dataUpdatedAt === 0) return 'not yet synced';
  const minutes = Math.floor((Date.now() - dataUpdatedAt) / 60_000);
  return minutes < 1 ? 'synced 0m ago' : `synced ${minutes}m ago`;
};

// The dashboard-level view of the same defect data behind /defects (DefectsTable): a
// read-only, always-visible queue of open failures that does not depend on an email or Teams
// alert being seen (ADR 0013). "View" deep-links into DefectsTable's own detail panel rather
// than duplicating the acknowledge/resolve/return-to-service actions here.
export const FailureQueue = (): ReactElement => {
  const { data: defects, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useDefects();
  const { data: equipmentList, isError: equipmentError } = useEquipment();
  const [filter, setFilter] = useState<QueueFilter>('ALL');

  const openDefects = useMemo(() => (defects ?? []).filter(isQueueOpen), [defects]);

  const filteredDefects = useMemo(() => {
    switch (filter) {
      case 'UNACKNOWLEDGED':
        return openDefects.filter((d) => d.status === 'OPEN');
      case 'ACTIVE':
        return openDefects.filter(isActive);
      case 'PENDING_APPROVAL':
        return openDefects.filter(isPendingApproval);
      default:
        return openDefects;
    }
  }, [openDefects, filter]);

  const criticalCount = useMemo(
    () => openDefects.filter((d) => d.severity === 'BLOCKING').length,
    [openDefects],
  );
  const newCount = useMemo(() => openDefects.filter(isNewToday).length, [openDefects]);

  if (isLoading) {
    return (
      <div className="rounded-sm border border-border bg-card p-8 text-center shadow-card">
        <p className="text-sm text-muted-foreground">Loading failure queue...</p>
      </div>
    );
  }

  // A failed fetch must not look like an empty queue: this is the reliable channel (ADR 0013),
  // so "0 open" has to mean genuinely zero, never "the request errored". Surface it distinctly.
  if (isError) {
    return (
      <div className="rounded-sm border border-destructive/40 bg-destructive/10 p-8 text-center shadow-card">
        <div className="flex items-center justify-center gap-2">
          <ShieldAlert className="size-5 text-destructive" aria-hidden />
          <p className="text-sm font-bold text-destructive">Failure queue unavailable</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The queue could not be loaded. Open failures may exist but cannot be shown right now. This
          is not an empty queue.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-destructive" aria-hidden />
          <h2 className="font-bold text-foreground">Failure Queue</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {criticalCount > 0 && (
            <span className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground">
              {criticalCount} critical
            </span>
          )}
          {newCount > 0 && (
            <span className="rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground">
              {newCount} new
            </span>
          )}
          <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
            {openDefects.length} open
          </span>
          <span className="text-xs text-muted-foreground">{syncedLabel(dataUpdatedAt)}</span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              filter === f.value
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
          No failures matching this filter
        </p>
      ) : (
        <>
          {/* Below md, a scrollable table just makes columns wider instead of wrapping text
              (browsers size table columns to their content first, only wrapping once the whole
              table can't grow), so narrow screens get a stacked card list instead of the table. */}
          <ul className="divide-y divide-border md:hidden">
            {filteredDefects.map((defect) => {
              const equipment = findEquipment(equipmentList, defect.equipmentId);
              return (
                <li key={defect.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <DefectSeverityTag severity={defect.severity} />
                      <DefectStatusTag status={defect.status} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatAge(defect.openedAt)}
                    </span>
                  </div>
                  <p className="mt-2 font-bold text-foreground">
                    {equipment?.name ?? defect.equipmentId}
                    <span className="ml-1 font-normal text-muted-foreground">
                      &middot; {equipment?.assetTag ?? '—'}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    <span className="font-bold">[{categoryFor(defect.itemKey)}]</span>{' '}
                    {defect.description}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {shortCode('INS', defect.inspectionId)}
                    </span>
                    <Link
                      href={`/defects?id=${defect.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:opacity-90"
                    >
                      View
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 font-bold">Priority</th>
                  <th className="p-3 font-bold">Equipment</th>
                  <th className="p-3 font-bold">Defect</th>
                  <th className="p-3 font-bold">Inspection</th>
                  <th className="p-3 font-bold">Status</th>
                  <th className="p-3 font-bold">Age</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDefects.map((defect) => {
                  const equipment = findEquipment(equipmentList, defect.equipmentId);
                  return (
                    <tr key={defect.id} className="align-top hover:bg-muted/50">
                      <td className="p-3">
                        <DefectSeverityTag severity={defect.severity} />
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-foreground">
                          {equipment?.name ?? defect.equipmentId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {equipment?.assetTag ?? '—'}
                        </p>
                      </td>
                      <td className="p-3">
                        <p className="line-clamp-2 max-w-md text-foreground">
                          <span className="font-bold">[{categoryFor(defect.itemKey)}]</span>{' '}
                          {defect.description}
                        </p>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {shortCode('INS', defect.inspectionId)}
                      </td>
                      <td className="p-3">
                        <DefectStatusTag status={defect.status} />
                      </td>
                      <td className="p-3 text-muted-foreground">{formatAge(defect.openedAt)}</td>
                      <td className="p-3">
                        <Link
                          href={`/defects?id=${defect.id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:opacity-90"
                        >
                          View
                          <ExternalLink className="size-3" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {equipmentError && (
        <p className="border-t border-warning/40 bg-warning/10 p-2 text-center text-xs text-warning">
          Equipment names are temporarily unavailable and may show as IDs.
        </p>
      )}

      <p className="hidden border-t border-border p-3 text-center text-xs text-muted-foreground sm:block">
        Queue persists across sessions &middot; entries clear when resolved and approved for return
        to service &middot; email &amp; Teams notifications are supplemental
      </p>
    </section>
  );
};

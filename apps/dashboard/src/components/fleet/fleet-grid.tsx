'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { CheckCircle, RefreshCw, XCircle } from 'lucide-react';
import type { EquipmentType, InspectionResult } from '@mat-inspect/shared-types';
import type { EquipmentWithLastInspection, InspectionListItem } from '@mat-inspect/shared-schemas';
import { useEquipment } from '@/hooks/use-equipment';
import { useInspections } from '@/hooks/use-inspections';
import { useInspectionDetail } from '@/hooks/use-inspection-detail';
import { categoryFor, formatDate } from '@/lib/defect-queue';
import { FleetStatusTag } from './fleet-status-tag';

type TypeFilter = EquipmentType | 'ALL';

const ALL_TYPES: EquipmentType[] = ['OVERHEAD_CRANE', 'TRUCK', 'ELECTRIC_PALLET_JACK', 'FORKLIFT'];

const RESULT_LABEL: Record<InspectionResult, string> = {
  PASS: 'Pass',
  FAIL_WARNING: 'Fail (Warning)',
  FAIL_BLOCKING: 'Fail (Blocking)',
};

const RESULT_CLASSES: Record<InspectionResult, string> = {
  PASS: 'bg-success text-success-foreground',
  FAIL_WARNING: 'bg-warning text-warning-foreground',
  FAIL_BLOCKING: 'bg-destructive text-destructive-foreground',
};

const InspectionResultTag = ({ result }: { result: InspectionResult }): ReactElement => (
  <span
    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${RESULT_CLASSES[result]}`}
  >
    {RESULT_LABEL[result]}
  </span>
);

const ResponseRow = ({
  response,
}: {
  response: { itemKey: string; passed: boolean; notes: string | null; notesSource: string | null };
}): ReactElement => (
  <li className="flex items-start gap-2 border-b border-border py-2 last:border-0">
    {response.passed ? (
      <CheckCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
    ) : (
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
    )}
    <div>
      <p className="text-sm font-medium text-foreground">
        {categoryFor(response.itemKey)}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {response.passed ? 'Passed' : 'Failed'}
        </span>
      </p>
      {response.notes && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {response.notesSource === 'VOICE_TRANSCRIBED' || response.notesSource === 'VOICE_EDITED'
            ? 'Voice transcript: '
            : 'Note: '}
          {response.notes}
        </p>
      )}
    </div>
  </li>
);

type HistoryEntryProps = {
  inspection: InspectionListItem;
  isExpanded: boolean;
  onToggle: () => void;
};

const HistoryEntry = ({ inspection, isExpanded, onToggle }: HistoryEntryProps): ReactElement => {
  const detail = useInspectionDetail(isExpanded ? inspection.id : null);

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-muted/50"
      >
        <div>
          <p className="text-sm font-medium text-foreground">
            {formatDate(inspection.submittedAt)}
          </p>
          <p className="text-xs text-muted-foreground">{inspection.operatorDisplayName}</p>
        </div>
        <InspectionResultTag result={inspection.result} />
      </button>

      {isExpanded && (
        <div className="pb-3 pl-1">
          {detail.isLoading && (
            <p className="text-xs text-muted-foreground">Loading responses...</p>
          )}
          {detail.isError && (
            <p className="text-xs text-destructive">Could not load this inspection's detail.</p>
          )}
          {detail.data && (
            <ul>
              {detail.data.responses.map((response) => (
                <ResponseRow key={response.id} response={response} />
              ))}
            </ul>
          )}
          {/* Photo evidence is not shown yet. The capture-to-persistence path is broken: the PWA
              captures and uploads a photo (DEV-32/DEV-33) but submit never stores the returned
              photoId, so neither inspection_responses nor defects.photo_ids carries a reference,
              and there is no retrieval route. Tracked in DEV-104, not silently dropped. */}
        </div>
      )}
    </li>
  );
};

const MachineDetailPanel = ({
  equipment,
}: {
  equipment: EquipmentWithLastInspection;
}): ReactElement => {
  const history = useInspections({ equipmentId: equipment.id });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="rounded-sm border border-border bg-card p-6 shadow-card">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-foreground">{equipment.name}</h2>
        <FleetStatusTag status={equipment.status} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{equipment.assetTag}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 rounded-sm bg-muted p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Type</p>
          <p className="text-sm text-foreground">{categoryFor(equipment.type)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Location
          </p>
          <p className="text-sm text-foreground">{equipment.location ?? 'Unknown'}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Last Inspection
          </p>
          <p className="text-sm text-foreground">
            {equipment.lastInspectionAt ? formatDate(equipment.lastInspectionAt) : 'Never'}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Operator
          </p>
          <p className="text-sm text-foreground">
            {equipment.lastInspectionOperatorDisplayName ?? '—'}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Inspection History
        </h3>

        {history.isLoading && <p className="text-sm text-muted-foreground">Loading history...</p>}
        {history.isError && (
          <div className="flex items-center justify-between rounded-sm border border-destructive/40 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">History could not be loaded.</p>
            <button
              type="button"
              onClick={() => history.refetch()}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Retry
            </button>
          </div>
        )}
        {history.data && history.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No inspections recorded yet.</p>
        )}
        {history.data && history.data.length > 0 && (
          <ul>
            {history.data.map((inspection) => (
              <HistoryEntry
                key={inspection.id}
                inspection={inspection}
                isExpanded={expandedId === inspection.id}
                onToggle={() => setExpandedId(expandedId === inspection.id ? null : inspection.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export const FleetGrid = (): ReactElement => {
  const { data: equipmentList, isLoading, isError, refetch } = useEquipment();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [locationFilter, setLocationFilter] = useState<string>('ALL');
  const [operatorFilter, setOperatorFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const locations = useMemo(
    () =>
      Array.from(
        new Set((equipmentList ?? []).map((e) => e.location).filter((v): v is string => !!v)),
      ).sort(),
    [equipmentList],
  );

  const operators = useMemo(
    () =>
      Array.from(
        new Set(
          (equipmentList ?? [])
            .map((e) => e.lastInspectionOperatorDisplayName)
            .filter((v): v is string => !!v),
        ),
      ).sort(),
    [equipmentList],
  );

  const filtered = useMemo(() => {
    return (equipmentList ?? []).filter((e) => {
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (locationFilter !== 'ALL' && e.location !== locationFilter) return false;
      if (operatorFilter !== 'ALL' && e.lastInspectionOperatorDisplayName !== operatorFilter) {
        return false;
      }
      const lastDate = e.lastInspectionAt?.slice(0, 10);
      if (dateFrom && (!lastDate || lastDate < dateFrom)) return false;
      if (dateTo && (!lastDate || lastDate > dateTo)) return false;
      return true;
    });
  }, [equipmentList, typeFilter, locationFilter, operatorFilter, dateFrom, dateTo]);

  const selected = filtered.find((e) => e.id === selectedId) ?? null;

  if (isLoading) {
    return (
      <div className="rounded-sm border border-border bg-card p-8 text-center shadow-card">
        <p className="text-sm text-muted-foreground">Loading fleet...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-sm border border-destructive/40 bg-destructive/10 p-8 text-center shadow-card">
        <p className="text-sm font-bold text-destructive">Fleet data unavailable</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <fieldset className="mb-4 grid grid-cols-2 gap-3 rounded-sm border border-border bg-card p-4 shadow-card sm:grid-cols-4">
        <legend className="sr-only">Filter fleet</legend>

        <div>
          <label htmlFor="fleet-filter-from" className="text-xs font-bold text-muted-foreground">
            From
          </label>
          <input
            id="fleet-filter-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="fleet-filter-to" className="text-xs font-bold text-muted-foreground">
            To
          </label>
          <input
            id="fleet-filter-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="fleet-filter-type" className="text-xs font-bold text-muted-foreground">
            Equipment Type
          </label>
          <select
            id="fleet-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">All types</option>
            {ALL_TYPES.map((type) => (
              <option key={type} value={type}>
                {categoryFor(type)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="fleet-filter-location"
            className="text-xs font-bold text-muted-foreground"
          >
            Location
          </label>
          <select
            id="fleet-filter-location"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">All locations</option>
            {locations.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label
            htmlFor="fleet-filter-operator"
            className="text-xs font-bold text-muted-foreground"
          >
            Operator
          </label>
          <select
            id="fleet-filter-operator"
            value={operatorFilter}
            onChange={(e) => setOperatorFilter(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">All operators</option>
            {operators.map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.4fr]">
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-bold text-foreground">Fleet Machines</h2>
            <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
              {filtered.length} of {equipmentList?.length ?? 0}
            </span>
          </div>

          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No machines match this filter
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((machine) => {
                const isSelected = selected?.id === machine.id;
                return (
                  <li key={machine.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(machine.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={`block w-full p-4 text-left transition-colors ${
                        isSelected ? 'bg-muted' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-foreground">{machine.name}</p>
                        <FleetStatusTag status={machine.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {machine.assetTag} &middot; {categoryFor(machine.type)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {machine.lastInspectionAt
                          ? `Last: ${formatDate(machine.lastInspectionAt)} · ${machine.lastInspectionOperatorDisplayName ?? 'Unknown'}`
                          : 'Never inspected'}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          {selected ? (
            <MachineDetailPanel equipment={selected} />
          ) : (
            <div className="rounded-sm border border-border bg-card p-8 text-center shadow-card">
              <p className="text-sm text-muted-foreground">
                Choose a machine from the list to view its full inspection history, readiness, and
                operator notes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

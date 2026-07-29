'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ShieldQuestion } from 'lucide-react';
import type { InspectionResult } from '@mat-inspect/shared-types';
import type { ReportFormat, ReportJobSummary } from '@mat-inspect/shared-schemas';
import { useEquipment } from '@/hooks/use-equipment';
import { useInspections } from '@/hooks/use-inspections';
import { useInspectionDetail } from '@/hooks/use-inspection-detail';
import { useMyReportExports } from '@/hooks/use-my-report-exports';
import { useRequestReportExport } from '@/hooks/use-request-report-export';
import { useReportJob } from '@/hooks/use-report-job';
import { findEquipment, formatDate, categoryFor } from '@/lib/defect-queue';
import { Checkbox } from '@/components/ui/checkbox';
import { InspectionResultTag, JobStatusBadge } from './audit-tags';

type Tab = 'HISTORY' | 'EXPORT' | 'MY_EXPORTS';

const TABS: { key: Tab; label: string }[] = [
  { key: 'HISTORY', label: 'Inspection History' },
  { key: 'EXPORT', label: 'Signed Export' },
  { key: 'MY_EXPORTS', label: 'My Exports' },
];

const HistoryTab = (): ReactElement => {
  const { data: inspections, isLoading, isError } = useInspections();
  const { data: equipmentList } = useEquipment();
  const [equipmentFilter, setEquipmentFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState<InspectionResult | 'ALL'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detail = useInspectionDetail(expandedId);

  const filtered = useMemo(
    () =>
      (inspections ?? []).filter((i) => {
        if (equipmentFilter !== 'ALL' && i.equipmentId !== equipmentFilter) return false;
        if (resultFilter !== 'ALL' && i.result !== resultFilter) return false;
        return true;
      }),
    [inspections, equipmentFilter, resultFilter],
  );

  if (isLoading) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">Loading inspection history...</p>
    );
  }
  if (isError) {
    return (
      <p className="p-8 text-center text-sm text-destructive">Could not load inspection history.</p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3 rounded-sm border border-border bg-card p-4 shadow-card">
        <select
          value={equipmentFilter}
          onChange={(e) => setEquipmentFilter(e.target.value)}
          className="rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="ALL">All equipment</option>
          {(equipmentList ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as InspectionResult | 'ALL')}
          className="rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="ALL">All results</option>
          <option value="PASS">Pass</option>
          <option value="FAIL_WARNING">Fail (Warning)</option>
          <option value="FAIL_BLOCKING">Fail (Blocking)</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No inspections match this filter
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((inspection) => {
              const equipment = findEquipment(equipmentList, inspection.equipmentId);
              const isExpanded = expandedId === inspection.id;
              return (
                <li key={inspection.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : inspection.id)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50"
                  >
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {equipment?.name ?? inspection.equipmentId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(inspection.submittedAt)} · {inspection.operatorDisplayName}
                      </p>
                    </div>
                    <InspectionResultTag result={inspection.result} />
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/40 p-4">
                      {detail.isLoading && (
                        <p className="text-xs text-muted-foreground">Loading full record...</p>
                      )}
                      {detail.isError && (
                        <p className="text-xs text-destructive">Could not load this record.</p>
                      )}
                      {detail.data && (
                        <ul className="space-y-1">
                          {detail.data.responses.map((response) => (
                            <li key={response.id} className="text-xs text-foreground">
                              {categoryFor(response.itemKey)}:{' '}
                              <span
                                className={response.passed ? 'text-success' : 'text-destructive'}
                              >
                                {response.passed ? 'Passed' : 'Failed'}
                              </span>
                              {response.notes && (
                                <span className="text-muted-foreground"> — {response.notes}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const ExportTab = ({ onExported }: { onExported: () => void }): ReactElement => {
  const { data: equipmentList } = useEquipment();
  const [format, setFormat] = useState<ReportFormat>('PDF');
  const [selectedEquipment, setSelectedEquipment] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const requestExport = useRequestReportExport();
  const job = useReportJob(jobId);

  const toggleEquipment = (id: string): void => {
    setSelectedEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = selectedEquipment.size > 0 && dateFrom && dateTo && !requestExport.isPending;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    requestExport.mutate(
      {
        format,
        filters: {
          equipmentIds: Array.from(selectedEquipment),
          dateFrom: new Date(dateFrom).toISOString(),
          dateTo: new Date(dateTo).toISOString(),
        },
        options: {
          includePhotos: true,
          includeVoiceTranscripts: true,
          includeAuditChainSegment: true,
        },
      },
      {
        onSuccess: (accepted) => {
          setJobId(accepted.jobId);
          onExported();
        },
      },
    );
  };

  return (
    <div className="rounded-sm border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex gap-4">
        {(['PDF', 'CSV'] as const).map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="radio"
              name="format"
              checked={format === f}
              onChange={() => setFormat(f)}
            />
            {f}
          </label>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-muted-foreground">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card p-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Equipment
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(equipmentList ?? []).map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={selectedEquipment.has(e.id)}
              onCheckedChange={() => toggleEquipment(e.id)}
            />
            {e.name}
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground hover:opacity-90 disabled:opacity-50"
      >
        Generate Signed Export
      </button>

      {requestExport.isError && (
        <p className="mt-2 text-xs text-destructive">Could not start the export. Try again.</p>
      )}

      {jobId && job.data && (
        <div className="mt-4 flex items-center gap-2 rounded-sm border border-border bg-muted p-3">
          <JobStatusBadge status={job.data.status} />
          {job.data.status === 'PROCESSING' && (
            <span className="text-sm text-foreground">Generating the signed file...</span>
          )}
          {job.data.status === 'READY' && (
            <a
              href={job.data.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold text-accent underline"
            >
              Download signed {job.data.format}
            </a>
          )}
          {job.data.status === 'FAILED' && (
            <span className="text-sm text-destructive">{job.data.errorDetail}</span>
          )}
        </div>
      )}
    </div>
  );
};

const ExportRow = ({ job }: { job: ReportJobSummary }): ReactElement => {
  const [revealed, setRevealed] = useState(false);
  const full = useReportJob(revealed ? job.jobId : null);

  useEffect(() => {
    if (full.data?.status === 'READY') {
      window.open(full.data.downloadUrl, '_blank', 'noopener,noreferrer');
      setRevealed(false);
    }
  }, [full.data]);

  return (
    <li className="flex items-center justify-between p-4">
      <div>
        <p className="text-sm font-bold text-foreground">
          {job.format} · {job.filters.equipmentIds.length} machine(s)
        </p>
        <p className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</p>
      </div>
      <div className="flex items-center gap-2">
        <JobStatusBadge status={job.status} />
        {job.status === 'READY' && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            disabled={revealed}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
          >
            {revealed ? 'Opening...' : 'Download'}
          </button>
        )}
      </div>
    </li>
  );
};

const MyExportsTab = (): ReactElement => {
  const { data: jobs, isLoading, isError } = useMyReportExports();

  if (isLoading)
    return <p className="p-8 text-center text-sm text-muted-foreground">Loading exports...</p>;
  if (isError)
    return <p className="p-8 text-center text-sm text-destructive">Could not load your exports.</p>;

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
      {!jobs || jobs.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No exports requested yet</p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => (
            <ExportRow key={job.jobId} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
};

// Chain verification (ADR 0007, ADR 0008) has no on-demand HTTP endpoint yet: the only check
// that runs today is the nightly job (services/audit/src/lib/nightly-verify.ts). Showing a fake
// "intact" result here would be exactly the fabricated compliance signal this project's rules
// forbid, so this stays a plain notice until that endpoint exists (needs its own backend ticket).
const ChainIntegrityNotice = (): ReactElement => (
  <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground">
    <ShieldQuestion className="size-4" aria-hidden />
    <span>Chain checked nightly (automatic). On-demand check: not built yet.</span>
  </div>
);

// DEV-113: unified page, top tab strip (History / Export / My Exports). Chain integrity status
// stays visible in the header regardless of tab, since it is a trust signal for the whole page.
// Chosen over a Browse/Compliance sidebar split after prototyping both (see /prototype skill);
// the ticket's own recommendation was to start unified and split later if operational browsing
// demand grows.
export const AuditView = (): ReactElement => {
  const [tab, setTab] = useState<Tab>('HISTORY');
  const { data: jobs } = useMyReportExports();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-bold ${
                tab === t.key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.label}
              {t.key === 'MY_EXPORTS' && jobs && jobs.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  {jobs.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <ChainIntegrityNotice />
      </div>

      {tab === 'HISTORY' && <HistoryTab />}
      {tab === 'EXPORT' && <ExportTab onExported={() => setTab('MY_EXPORTS')} />}
      {tab === 'MY_EXPORTS' && <MyExportsTab />}
    </div>
  );
};

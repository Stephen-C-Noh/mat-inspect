'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo, type ReactElement } from 'react';
import { ChevronLeft, CheckCircle, XCircle, ImageIcon, Mic } from 'lucide-react';
import type { InspectionResponseRecord } from '@mat-inspect/shared-schemas';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '@/hooks/use-equipment';
import { useMyInspectionDetail } from '@/hooks/use-my-inspections';
import { RESULT_DISPLAY, formatInspectionDate } from '@/lib/inspection-display';

// The stored itemKey is a slug (e.g. festooned_cables). The detail record carries no prompt text,
// so present the key humanized rather than fetching the pinned template just for labels.
const humanizeKey = (key: string): string =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function ResponseRow({ response }: { response: InspectionResponseRecord }): ReactElement {
  const isVoice =
    response.notesSource === 'VOICE_TRANSCRIBED' || response.notesSource === 'VOICE_EDITED';
  return (
    <div className="rounded-sm border border-border bg-card p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-bold text-foreground">{humanizeKey(response.itemKey)}</h4>
        {response.passed ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-success">
            <CheckCircle className="size-3.5" /> Pass
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-destructive">
            <XCircle className="size-3.5" /> Fail
          </span>
        )}
      </div>

      {typeof response.value === 'string' && response.value.trim().length > 0 && (
        <p className="mt-1 text-sm text-foreground">{response.value}</p>
      )}

      {response.notes && (
        <p className="mt-2 flex items-start gap-1.5 text-sm italic text-muted-foreground">
          {isVoice && <Mic className="mt-0.5 size-3.5 shrink-0" />}
          {response.notes}
        </p>
      )}

      {response.photoIds.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ImageIcon className="size-3.5" />
          {response.photoIds.length} photo{response.photoIds.length === 1 ? '' : 's'} attached
        </p>
      )}
    </div>
  );
}

function DetailContent(): ReactElement {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: equipmentList } = useEquipmentList();
  const { data: inspection, isLoading, error } = useMyInspectionDetail(params.id);

  const equipment = useMemo(
    () => equipmentList?.find((e) => e.id === inspection?.equipmentId),
    [equipmentList, inspection?.equipmentId],
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
        <span className="text-sm font-extrabold uppercase tracking-wide">Inspection Record</span>
      </header>

      <div className="mx-auto max-w-lg space-y-4 p-4">
        {isLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading...</p>}
        {error && (
          <p className="p-8 text-center text-sm text-destructive">
            Could not load this inspection. It may not be one of yours.
          </p>
        )}

        {inspection && (
          <>
            <div className="rounded-sm border border-border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-bold uppercase tracking-widest text-warning">
                    Equipment
                  </p>
                  <p className="text-lg font-extrabold text-foreground">
                    {equipment?.name ?? 'Equipment'}
                  </p>
                  {equipment?.assetTag && (
                    <p className="text-xs text-muted-foreground">{equipment.assetTag}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-bold ${RESULT_DISPLAY[inspection.result].badgeClass}`}
                >
                  {RESULT_DISPLAY[inspection.result].label}
                </span>
              </div>

              <div className="mt-3 border-t border-border pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-medium text-foreground">
                    {formatInspectionDate(inspection.submittedAt)}
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Inspector</span>
                  <span className="font-medium text-foreground">
                    {inspection.operatorDisplayName}
                  </span>
                </div>
              </div>
            </div>

            <h3 className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Checklist Responses
            </h3>
            <div className="space-y-2">
              {inspection.responses.map((response) => (
                <ResponseRow key={response.id} response={response} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function InspectionDetailPage(): ReactElement {
  return (
    <AuthGuard>
      <DetailContent />
    </AuthGuard>
  );
}

import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { InspectionResult } from '@mat-inspect/shared-types';
import type { ReportJobStatus } from '@mat-inspect/shared-schemas';

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

export const InspectionResultTag = ({ result }: { result: InspectionResult }): ReactElement => (
  <span
    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${RESULT_CLASSES[result]}`}
  >
    {RESULT_LABEL[result]}
  </span>
);

const JOB_STATUS_LABEL: Record<ReportJobStatus, string> = {
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

const JOB_STATUS_CLASSES: Record<ReportJobStatus, string> = {
  PROCESSING: 'bg-muted text-muted-foreground',
  READY: 'bg-success text-success-foreground',
  FAILED: 'bg-destructive text-destructive-foreground',
};

export const JobStatusBadge = ({ status }: { status: ReportJobStatus }): ReactElement => (
  <span
    className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold ${JOB_STATUS_CLASSES[status]}`}
  >
    {status === 'PROCESSING' && <Loader2 className="size-3 animate-spin" aria-hidden />}
    {JOB_STATUS_LABEL[status]}
  </span>
);

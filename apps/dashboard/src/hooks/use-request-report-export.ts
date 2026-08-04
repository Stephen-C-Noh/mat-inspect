import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import {
  reportExportRequestSchema,
  reportJobAcceptedSchema,
  type ReportExportRequest,
  type ReportJobAccepted,
} from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { MY_REPORT_EXPORTS_QUERY_KEY } from './use-my-report-exports';

// Backs the Audit page's export form (DEV-113): POST /api/v1/reports/export. The job row is
// inserted before the 202 response is sent (services/audit/src/routes/reports/export.ts), so
// invalidating the exports list here is enough for the new job to show up as PROCESSING; no need
// to hand-append it client-side.
export const useRequestReportExport = (): UseMutationResult<
  ReportJobAccepted,
  Error,
  ReportExportRequest
> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReportExportRequest) => {
      const accessToken = await acquireAccessToken(instance, accounts);
      const body = reportExportRequestSchema.parse(input);

      const res = await fetch('/api/v1/reports/export', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Failed to request report export: ${res.status}`);

      return reportJobAcceptedSchema.parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_REPORT_EXPORTS_QUERY_KEY }),
  });
};

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { reportJobResponseSchema, type ReportJobResponse } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { MY_REPORT_EXPORTS_QUERY_KEY } from './use-my-report-exports';

const POLL_INTERVAL_MS = 2000;

// Polls GET /api/v1/reports/:jobId while a just-submitted export is PROCESSING (DEV-113). Stops
// polling once the job reaches READY or FAILED; the exports list is invalidated at that point so
// the "My Exports" row picks up the same terminal status without a second poll loop there.
export const useReportJob = (jobId: string | null): UseQueryResult<ReportJobResponse, Error> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();
  const lastStatus = useRef<ReportJobResponse['status'] | null>(null);

  const query = useQuery<ReportJobResponse, Error>({
    queryKey: ['report-job', jobId],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/reports/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch report job: ${res.status}`);

      return reportJobResponseSchema.parse(await res.json());
    },
    enabled: accounts.length > 0 && jobId !== null,
    refetchInterval: (q) => (q.state.data?.status === 'PROCESSING' ? POLL_INTERVAL_MS : false),
  });

  useEffect(() => {
    const status = query.data?.status ?? null;
    if (status && status !== 'PROCESSING' && lastStatus.current === 'PROCESSING') {
      queryClient.invalidateQueries({ queryKey: MY_REPORT_EXPORTS_QUERY_KEY });
    }
    lastStatus.current = status;
  }, [query.data?.status, queryClient]);

  return query;
};

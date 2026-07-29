import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { reportJobSummarySchema, type ReportJobSummary } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

export const MY_REPORT_EXPORTS_QUERY_KEY = ['report-exports', 'me'] as const;

// Backs the Audit page's "My Exports" tab (DEV-113): GET /api/v1/reports/me/exports, routed
// straight to the audit service (infra/caddy/Caddyfile), not through core-api. supervisor sees
// only its own jobs; manager/auditor/admin get the same response widened server-side to any
// requester's jobs (VIEW_ANY_JOB_ROLES in the audit service).
export const useMyReportExports = (): UseQueryResult<ReportJobSummary[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<ReportJobSummary[], Error>({
    queryKey: MY_REPORT_EXPORTS_QUERY_KEY,
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch('/api/v1/reports/me/exports', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch report exports: ${res.status}`);

      return reportJobSummarySchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
  });
};

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { defectSchema, type Defect } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { CROSS_SESSION_SAFETY_POLL_INTERVAL_MS } from '@/lib/polling';

export const DEFECTS_QUERY_KEY = ['defects'] as const;

export const useDefects = (): UseQueryResult<Defect[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Defect[], Error>({
    queryKey: DEFECTS_QUERY_KEY,
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch('/api/v1/defects', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch defects: ${res.status}`);

      return defectSchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
    // A blocking defect raised by an inspection submit arrives through the activity feed, which
    // invalidates this query (ADR 0026). The slow interval covers the other direction: a defect
    // acknowledged or resolved in another manager's session, which no feed reports. The manual
    // Refresh control stays as a fallback.
    refetchInterval: CROSS_SESSION_SAFETY_POLL_INTERVAL_MS,
  });
};

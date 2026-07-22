import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { defectSchema, type Defect } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

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
  });
};

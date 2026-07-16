import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import type { Defect } from '@mat-inspect/shared-schemas';
import { listDefects } from '@/lib/mock-defects';

export const DEFECTS_QUERY_KEY = ['defects'] as const;

// Reads from the mock-defects data layer (see lib/mock-defects.ts) until DEV-20's real API
// merges. At that point this becomes a fetch('/api/v1/defects') + defectSchema.array().parse(...)
// call using acquireAccessToken, identical in shape to pwa's use-equipment.ts.
export const useDefects = (): UseQueryResult<Defect[], Error> => {
  const { accounts } = useMsal();

  return useQuery<Defect[], Error>({
    queryKey: DEFECTS_QUERY_KEY,
    queryFn: () => listDefects(),
    enabled: accounts.length > 0,
  });
};

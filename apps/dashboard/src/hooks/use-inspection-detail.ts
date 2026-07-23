import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { inspectionDetailSchema, type InspectionDetail } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

// Backs the drilldown's expanded inspection view (DEV-37): one inspection's full responses,
// fetched only when an entry in the history list is opened, not for every row up front.
export const useInspectionDetail = (
  inspectionId: string | null,
): UseQueryResult<InspectionDetail, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<InspectionDetail, Error>({
    queryKey: ['inspection', inspectionId],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/inspections/${inspectionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch inspection: ${res.status}`);

      return inspectionDetailSchema.parse(await res.json());
    },
    enabled: accounts.length > 0 && inspectionId !== null,
  });
};

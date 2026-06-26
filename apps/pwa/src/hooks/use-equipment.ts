import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/access-token';

export const useEquipmentList = (): UseQueryResult<Equipment[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Equipment[], Error>({
    queryKey: ['equipment'],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch('/api/v1/equipment', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      // Validate the response against the shared schema
      return equipmentSchema.array().parse(await res.json());
    },

    // Only attempt the query if the user is logged in
    enabled: accounts.length > 0,
  });
};

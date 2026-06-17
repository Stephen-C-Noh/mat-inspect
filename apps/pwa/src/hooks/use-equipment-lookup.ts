import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { tokenRequest } from '@/lib/msal-config';

// Hook to resolve equipment records via asset tag.
// Ensures authentication via MSAL and strictly enforces the API 404 contract.
export const useEquipmentLookup = (assetTag: string | null): UseQueryResult<Equipment, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Equipment, Error>({
    queryKey: ['equipment', assetTag],
    queryFn: async () => {
      if (!assetTag) throw new Error('No asset tag provided');

      // Acquire token silently to maintain PWA session continuity without login redirects
      const response = await instance.acquireTokenSilent({
        ...tokenRequest,
        account: accounts[0],
      });

      const res = await fetch(`/api/v1/equipment/by-tag/${assetTag}`, {
        headers: { Authorization: `Bearer ${response.accessToken}` },
      });

      if (res.status === 404) throw new Error('EQUIPMENT_NOT_FOUND');
      if (!res.ok) throw new Error('Failed to fetch equipment');

      return equipmentSchema.parse(await res.json());
    },
    enabled: !!assetTag,
    retry: false, // Prevents unnecessary API hammering on 404s
  });
};

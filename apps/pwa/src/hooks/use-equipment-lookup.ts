'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { tokenRequest } from '@/lib/msal-config';

export const useEquipmentLookup = (assetTag: string | null): UseQueryResult<Equipment, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Equipment, Error>({
    queryKey: ['equipment', assetTag],
    queryFn: async () => {
      if (!assetTag) throw new Error('No asset tag provided');

      const response = await instance.acquireTokenSilent({
        ...tokenRequest,
        account: accounts[0],
      });

      const res = await fetch(`/api/v1/equipment/by-tag/${assetTag}`, {
        headers: {
          Authorization: `Bearer ${response.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401) throw new Error('401_UNAUTHORIZED');
      if (res.status === 404) throw new Error('EQUIPMENT_NOT_FOUND');
      if (!res.ok) throw new Error(`Failed to fetch equipment: ${res.status}`);

      return equipmentSchema.parse(await res.json());
    },
    enabled: !!assetTag,
    retry: false,
  });
};

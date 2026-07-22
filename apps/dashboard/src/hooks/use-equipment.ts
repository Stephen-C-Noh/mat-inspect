import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

export const EQUIPMENT_QUERY_KEY = ['equipment'] as const;

export const useEquipment = (): UseQueryResult<Equipment[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Equipment[], Error>({
    queryKey: EQUIPMENT_QUERY_KEY,
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch('/api/v1/equipment', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch equipment: ${res.status}`);

      return equipmentSchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
  });
};

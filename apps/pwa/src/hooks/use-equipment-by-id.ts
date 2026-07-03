import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/access-token';

// Fetches a single equipment record by id (GET /equipment/:id). The lockout tag screen uses
// this so equipment identity (name, tag, status) comes from the server, not from
// client-supplied URL params that anyone could fabricate.
export const useEquipmentById = (
  equipmentId: string | undefined,
): UseQueryResult<Equipment, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Equipment, Error>({
    queryKey: ['equipment', 'by-id', equipmentId],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/equipment/${equipmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 401) throw new Error('401_UNAUTHORIZED');
      if (res.status === 404) throw new Error('EQUIPMENT_NOT_FOUND');
      if (!res.ok) throw new Error(`Failed to fetch equipment: ${res.status}`);

      return equipmentSchema.parse(await res.json());
    },
    enabled: accounts.length > 0 && !!equipmentId,
    retry: false,
  });
};

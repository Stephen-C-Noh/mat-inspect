import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import {
  equipmentWithLastInspectionSchema,
  type EquipmentWithLastInspection,
} from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

export const EQUIPMENT_QUERY_KEY = ['equipment'] as const;

// GET /api/v1/equipment now returns each machine's last-inspection summary alongside the base
// contract (DEV-37), so every existing caller (FailureQueue, DefectsTable) keeps working off the
// same fields it always used, and the fleet grid gets the extra ones for free.
export const useEquipment = (): UseQueryResult<EquipmentWithLastInspection[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<EquipmentWithLastInspection[], Error>({
    queryKey: EQUIPMENT_QUERY_KEY,
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch('/api/v1/equipment', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch equipment: ${res.status}`);

      return equipmentWithLastInspectionSchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
  });
};

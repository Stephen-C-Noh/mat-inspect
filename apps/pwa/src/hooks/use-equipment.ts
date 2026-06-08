import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Equipment } from '@mat-inspect/shared-schemas';

export const useEquipmentList = (): UseQueryResult<Equipment[], Error> => {
  return useQuery<Equipment[], Error>({
    queryKey: ['equipment'],
    queryFn: async () => {
      // TODO: Replace /dev/token with actual MSAL/Azure Auth flow once integrated.
      // Currently using a dev bypass for local PWA operation as per DEV-7 requirements.

      const tokenRes = await fetch('/dev/token?role=operator');
      if (!tokenRes.ok) throw new Error('Token acquisition failed');
      const { token } = await tokenRes.json();

      // Fetch records
      const res = await fetch('/api/v1/equipment', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return res.json();
    },
  });
};

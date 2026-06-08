import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Equipment } from '@mat-inspect/shared-schemas';

export const useEquipmentList = (): UseQueryResult<Equipment[], Error> => {
  return useQuery<Equipment[], Error>({
    queryKey: ['equipment'],
    queryFn: async () => {
      // TODO: replace /dev/token with the MSAL/Azure auth flow once integrated.
      // The dev bypass exists so the PWA runs locally without Entra ID (DEV-7 scaffolding).
      const tokenRes = await fetch('/dev/token?role=operator');
      if (!tokenRes.ok) throw new Error('Token acquisition failed');
      const { token } = await tokenRes.json();

      // The core-api requires a bearer token on every request, so attach it here.
      const res = await fetch('/api/v1/equipment', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return res.json();
    },
  });
};

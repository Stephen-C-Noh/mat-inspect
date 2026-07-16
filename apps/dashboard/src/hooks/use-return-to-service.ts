import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { DEFECTS_QUERY_KEY } from './use-defects';

export const useReturnToService = (): UseMutationResult<Equipment, Error, string> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (equipmentId: string) => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/equipment/${equipmentId}/return-to-service`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to approve return to service: ${res.status}`);

      return equipmentSchema.parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
    },
  });
};

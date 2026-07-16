import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { defectSchema, type Defect } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { DEFECTS_QUERY_KEY } from './use-defects';

export const useAcknowledgeDefect = (): UseMutationResult<Defect, Error, string> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (defectId: string) => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/defects/${defectId}/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to acknowledge defect: ${res.status}`);

      return defectSchema.parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY }),
  });
};

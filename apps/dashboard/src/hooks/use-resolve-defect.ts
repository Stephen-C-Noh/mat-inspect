import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { defectSchema, resolveDefectSchema, type Defect } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { DEFECTS_QUERY_KEY } from './use-defects';

type ResolveDefectInput = { defectId: string; resolutionNotes: string };

export const useResolveDefect = (): UseMutationResult<Defect, Error, ResolveDefectInput> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ defectId, resolutionNotes }: ResolveDefectInput) => {
      const accessToken = await acquireAccessToken(instance, accounts);
      const body = resolveDefectSchema.parse({ resolutionNotes });

      const res = await fetch(`/api/v1/defects/${defectId}/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Failed to resolve defect: ${res.status}`);

      return defectSchema.parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY }),
  });
};

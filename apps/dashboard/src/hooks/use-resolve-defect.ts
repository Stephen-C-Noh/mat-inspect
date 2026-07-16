import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { Defect } from '@mat-inspect/shared-schemas';
import { resolveDefect } from '@/lib/mock-defects';
import { DEFECTS_QUERY_KEY } from './use-defects';

type ResolveDefectInput = { defectId: string; resolutionNotes: string };

export const useResolveDefect = (): UseMutationResult<Defect, Error, ResolveDefectInput> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ defectId, resolutionNotes }: ResolveDefectInput) =>
      resolveDefect(defectId, resolutionNotes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY }),
  });
};

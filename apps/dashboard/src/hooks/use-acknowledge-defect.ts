import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { Defect } from '@mat-inspect/shared-schemas';
import { acknowledgeDefect } from '@/lib/mock-defects';
import { DEFECTS_QUERY_KEY } from './use-defects';

export const useAcknowledgeDefect = (): UseMutationResult<Defect, Error, string> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (defectId: string) => acknowledgeDefect(defectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY }),
  });
};

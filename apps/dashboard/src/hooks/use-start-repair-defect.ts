import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { Defect } from '@mat-inspect/shared-schemas';
import { startRepairDefect } from '@/lib/mock-defects';
import { DEFECTS_QUERY_KEY } from './use-defects';

export const useStartRepairDefect = (): UseMutationResult<Defect, Error, string> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (defectId: string) => startRepairDefect(defectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY }),
  });
};

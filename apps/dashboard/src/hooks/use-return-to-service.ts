import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnToService } from '@/lib/mock-defects';
import { DEFECTS_QUERY_KEY } from './use-defects';

export const useReturnToService = (): UseMutationResult<void, Error, string> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (equipmentId: string) => returnToService(equipmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY }),
  });
};

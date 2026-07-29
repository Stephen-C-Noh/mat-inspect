import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import {
  checklistTemplateSchema,
  publishChecklistTemplateSchema,
  type ChecklistTemplate,
  type PublishChecklistTemplate,
} from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { CHECKLIST_TEMPLATES_QUERY_KEY } from './use-checklist-templates';

// reviewedBy is out of scope for v1 (no user-list API exists to pick a reviewer from), so
// callers never populate it and the server's self-review rejection is unreachable here.
export const usePublishChecklistTemplate = (): UseMutationResult<
  ChecklistTemplate,
  Error,
  PublishChecklistTemplate
> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PublishChecklistTemplate) => {
      const accessToken = await acquireAccessToken(instance, accounts);
      const body = publishChecklistTemplateSchema.parse(input);

      const res = await fetch('/api/v1/checklists', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Failed to publish checklist template: ${res.status}`);

      return checklistTemplateSchema.parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECKLIST_TEMPLATES_QUERY_KEY }),
  });
};

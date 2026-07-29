import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { checklistTemplateSchema, type ChecklistTemplate } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

export const CHECKLIST_TEMPLATES_QUERY_KEY = ['checklist-templates'] as const;

// Backs the admin template-management screen: full publish history across every equipment
// type, including retired versions (mirrors GET /api/v1/checklists, admin-only server-side).
export const useChecklistTemplates = (): UseQueryResult<ChecklistTemplate[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<ChecklistTemplate[], Error>({
    queryKey: CHECKLIST_TEMPLATES_QUERY_KEY,
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch('/api/v1/checklists', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch checklist templates: ${res.status}`);

      return checklistTemplateSchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
  });
};

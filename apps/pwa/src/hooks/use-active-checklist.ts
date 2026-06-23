import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { checklistTemplateSchema, type ChecklistTemplate } from '@mat-inspect/shared-schemas';
import type { EquipmentType } from '@mat-inspect/shared-types';
import { tokenRequest } from '@/lib/msal-config';

export const useActiveChecklist = (
  equipmentType: EquipmentType | undefined,
): UseQueryResult<ChecklistTemplate, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<ChecklistTemplate, Error>({
    queryKey: ['active-checklist', equipmentType],
    queryFn: async () => {
      let response;
      try {
        response = await instance.acquireTokenSilent({
          ...tokenRequest,
          account: accounts[0],
        });
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) {
          await instance.acquireTokenRedirect({ ...tokenRequest, account: accounts[0] });
        }
        throw err;
      }

      const res = await fetch(`/api/v1/checklists/active?type=${equipmentType}`, {
        headers: { Authorization: `Bearer ${response.accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      return checklistTemplateSchema.parse(await res.json());
    },

    enabled: accounts.length > 0 && !!equipmentType,
  });
};

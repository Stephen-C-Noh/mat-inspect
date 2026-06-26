import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { checklistTemplateSchema, type ChecklistTemplate } from '@mat-inspect/shared-schemas';
import type { EquipmentType } from '@mat-inspect/shared-types';
import { acquireAccessToken } from '@/lib/access-token';

// Fetches the active checklist template for an equipment type (DEV-13 endpoint). The query
// stays disabled until the equipment type is known, so the equipment lookup (DEV-15) runs first.
export const useActiveChecklist = (
  equipmentType: EquipmentType | undefined,
): UseQueryResult<ChecklistTemplate, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<ChecklistTemplate, Error>({
    queryKey: ['active-checklist', equipmentType],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(
        `/api/v1/checklists/active?type=${encodeURIComponent(equipmentType as EquipmentType)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      return checklistTemplateSchema.parse(await res.json());
    },

    enabled: accounts.length > 0 && !!equipmentType,
  });
};

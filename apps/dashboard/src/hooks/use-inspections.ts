import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { inspectionListItemSchema, type InspectionListItem } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

export type InspectionFilters = {
  equipmentId?: string;
  operatorId?: string;
  from?: string;
  to?: string;
};

// Backs the fleet drilldown's full inspection history for one machine (DEV-37). Filters map
// directly onto GET /api/v1/inspections' query params; an empty filters object fetches the
// most recent inspections fleet-wide.
export const useInspections = (
  filters: InspectionFilters = {},
): UseQueryResult<InspectionListItem[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<InspectionListItem[], Error>({
    queryKey: ['inspections', filters],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const params = new URLSearchParams();
      if (filters.equipmentId) params.set('equipmentId', filters.equipmentId);
      if (filters.operatorId) params.set('operatorId', filters.operatorId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const queryString = params.toString();

      const res = await fetch(`/api/v1/inspections${queryString ? `?${queryString}` : ''}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch inspections: ${res.status}`);

      return inspectionListItemSchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
    // No timer. The history panel is refreshed by the activity feed when a new inspection lands
    // (ADR 0026). Individual rows never change once written (ADR 0008); the list they form does.
  });
};

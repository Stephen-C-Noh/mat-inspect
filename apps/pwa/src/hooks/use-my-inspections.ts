import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import {
  inspectionListItemSchema,
  inspectionDetailSchema,
  type InspectionListItem,
  type InspectionDetail,
} from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';

export type MyInspectionFilters = {
  equipmentId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

// The operator's own inspection history (DEV-115). core-api scopes GET /api/v1/inspections to the
// authenticated operator server-side, so no operatorId is sent: an operator only ever gets their
// own records, and a request for someone else's is refused there, not here.
export const useMyInspections = (
  filters: MyInspectionFilters = {},
): UseQueryResult<InspectionListItem[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<InspectionListItem[], Error>({
    queryKey: ['my-inspections', filters],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const params = new URLSearchParams();
      if (filters.equipmentId) params.set('equipmentId', filters.equipmentId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.limit) params.set('limit', String(filters.limit));
      const queryString = params.toString();

      const res = await fetch(`/api/v1/inspections${queryString ? `?${queryString}` : ''}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch inspections: ${res.status}`);

      return inspectionListItemSchema.array().parse(await res.json());
    },
    enabled: accounts.length > 0,
  });
};

// One inspection's full record, including per-item responses and any voice-transcript notes. Backed
// by GET /api/v1/inspections/:id, which returns 404 for an inspection the operator does not own.
export const useMyInspectionDetail = (
  id: string | undefined,
): UseQueryResult<InspectionDetail, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<InspectionDetail, Error>({
    queryKey: ['my-inspection-detail', id],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/inspections/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch inspection: ${res.status}`);

      return inspectionDetailSchema.parse(await res.json());
    },
    enabled: accounts.length > 0 && !!id,
    // A 404 is expected here (an id the operator does not own, or a bad deep link); do not retry an
    // error that will not change. Matches use-equipment-by-id / use-equipment-lookup.
    retry: false,
  });
};

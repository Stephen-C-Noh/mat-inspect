import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { equipmentSchema, type Equipment } from '@mat-inspect/shared-schemas';
import { tokenRequest } from '@/lib/msal-config';

export const useEquipmentList = (): UseQueryResult<Equipment[], Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Equipment[], Error>({
    queryKey: ['equipment'],
    queryFn: async () => {
      // Acquire the access token silently. If the session expired or consent is
      // missing, MSAL throws InteractionRequiredAuthError; fall back to a redirect
      // so the user re-authenticates instead of the query failing permanently.
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

      const res = await fetch('/api/v1/equipment', {
        headers: { Authorization: `Bearer ${response.accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      // Validate the response against the shared schema
      return equipmentSchema.array().parse(await res.json());
    },

    // Only attempt the query if the user is logged in
    enabled: accounts.length > 0,
  });
};

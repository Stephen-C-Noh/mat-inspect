import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { acquireAccessToken } from '@/lib/auth';

// Fetches an evidence photo's bytes from the Media Service by id, PWA to Media direct (ADR 0020,
// ADR 0023, DEV-131). core-api never sees the bytes, only the photoId reference the checklist
// screens already carry. Returns a local object URL for an <img src>.
export const usePhoto = (photoId: string | null): UseQueryResult<string, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<string, Error>({
    queryKey: ['photo', photoId],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/media/photos/${photoId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch photo: ${res.status}`);

      return URL.createObjectURL(await res.blob());
    },
    enabled: accounts.length > 0 && photoId !== null,
  });
};

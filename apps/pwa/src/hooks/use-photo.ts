import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { acquireAccessToken } from '@/lib/auth';

// Fetches an evidence photo's bytes from the Media Service by id, PWA to Media direct (ADR 0020,
// ADR 0023, DEV-131). core-api never sees the bytes, only the photoId reference the checklist
// screens already carry. Returns the Blob rather than an object URL: an object URL is a browser
// resource that must be revoked by whoever created it, and the query cache is not a component, so
// it cannot own that lifecycle (see useObjectUrl).
export const usePhotoBlob = (photoId: string | null): UseQueryResult<Blob, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Blob, Error>({
    queryKey: ['photo', photoId],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/media/photos/${photoId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch photo: ${res.status}`);

      return res.blob();
    },
    enabled: accounts.length > 0 && photoId !== null,
    // An uploaded photo is immutable evidence addressed by its id (ADR 0023), so the bytes behind a
    // photoId can never go stale. Without this the query inherits the global 30 s staleTime and
    // refetches a 3 to 8 MB camera JPEG every time a checklist card is collapsed and reopened,
    // because the card unmounts its body (checklist-item-card) and Media answers no-store, so the
    // browser cache cannot absorb it either. gcTime is left at its default so the blobs are still
    // evicted once nothing is rendering them.
    staleTime: Infinity,
  });
};

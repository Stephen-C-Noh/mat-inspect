import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import { acquireAccessToken } from '@/lib/auth';

// Fetches a ready report's bytes from the Audit Service's own authenticated download route
// (DEV-113 follow-up), same pattern as the PWA's usePhotoBlob against media/get-photo.ts. A plain
// <a href>/window.open on that route cannot work: it requires an Entra Bearer token, which only a
// fetch with an Authorization header can attach, unlike a browser navigation. This replaces an
// earlier Azure Blob SAS URL, which was a self-authenticating link a bare navigation could follow
// but pointed at Azurite's Docker-internal hostname in dev.
export const useReportDownload = (jobId: string | null): UseQueryResult<Blob, Error> => {
  const { instance, accounts } = useMsal();

  return useQuery<Blob, Error>({
    queryKey: ['report-download', jobId],
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const res = await fetch(`/api/v1/reports/${jobId}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error(`Failed to fetch report file: ${res.status}`);

      return res.blob();
    },
    enabled: accounts.length > 0 && jobId !== null,
    // A ready report's bytes never change (ADR 0008), so once fetched the blob can never go
    // stale.
    staleTime: Infinity,
  });
};

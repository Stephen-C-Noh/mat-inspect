import { useEffect, useState } from 'react';

// Creates a local object URL for a Blob and revokes it when the Blob changes or the component
// unmounts. The URL is owned by this hook's caller, not by whatever cached the Blob (e.g. a
// TanStack Query entry): a query cache entry outlives any one component, so revoking there would
// either leak (never revoked) or break other mounted consumers of the same cached Blob (revoked
// out from under them). Each caller creates and revokes its own URL, so two components rendering
// the same photoId do not interfere with each other.
export const useObjectUrl = (blob: Blob | null | undefined): string | null => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
};

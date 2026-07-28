import type { ReactElement } from 'react';
import { ImageIcon } from 'lucide-react';
import { usePhotoBlob } from '@/hooks/use-photo';
import { useObjectUrl } from '@/hooks/use-object-url';

// Fetches an uploaded evidence photo by id and shows it, falling back to a placeholder while
// loading, on a fetch error, or when there is no id yet (DEV-131). Shared by every screen that
// shows a failed item's photo (submitted/fail confirmation, and the merged checklist card,
// DEV-134), so the fetch-by-id behavior stays in one place regardless of which screen renders it.
export const EvidencePhoto = ({ photoId }: { photoId: string | null }): ReactElement => {
  const { data: photoBlob } = usePhotoBlob(photoId);
  const photoUrl = useObjectUrl(photoBlob);

  return (
    <div className="flex h-36 items-center justify-center overflow-hidden rounded-sm bg-muted">
      {photoUrl ? (
        <img src={photoUrl} alt="Evidence" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="size-8 text-muted-foreground" />
      )}
    </div>
  );
};

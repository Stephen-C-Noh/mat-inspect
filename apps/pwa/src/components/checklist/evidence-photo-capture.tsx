import { useRef, type ChangeEvent, type ReactElement } from 'react';
import { ImageIcon, Loader2, X } from 'lucide-react';
import { usePhotoUpload } from '@/hooks/use-photo-upload';
import { EvidencePhoto } from './evidence-photo';

type Props = {
  photoIds: string[];
  onPhotoIdsChange: (photoIds: string[]) => void;
};

// Inline evidence capture for a BOOLEAN_PHOTO_ON_FAIL item marked fail (DEV-134 merges the old
// standalone failures screen into this card). Photo only: the defect note and its dictate button
// belong to every failed item, not just the photo-required ones (ARCHITECTURE.md 7.1), so they live
// in the card's Notes block instead. One evidence photo per item, matching how every downstream
// reader already treats photoIds (review page, submitted/fail confirmation, buildSubmitPayload all
// read photoIds[0]).
export const EvidencePhotoCapture = ({ photoIds, onPhotoIdsChange }: Props): ReactElement => {
  const fileRef = useRef<HTMLInputElement>(null);
  // The hook reports the uploaded id through a callback, so this component holds no copy of it: the
  // draft (photoIds) is the single source of truth and the hook's state only drives the preview.
  const photoUpload = usePhotoUpload((photoId) => onPhotoIdsChange([photoId]));

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) photoUpload.upload(file);
  };

  const handleRemovePhoto = (): void => {
    photoUpload.clear();
    onPhotoIdsChange([]);
  };

  // Restored from the draft after a page load (photoId persisted, no local blob to show). Once the
  // operator takes a new photo in this session, photoUpload.state is the source of truth instead,
  // so its preview shows even a render before the parent has re-rendered with the new photoIds.
  const persistedPhotoId = photoIds[0] ?? null;
  const hasPhoto = photoUpload.state.status !== 'idle' || persistedPhotoId !== null;

  const retake = (): void => fileRef.current?.click();

  return (
    <div className="mt-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {!hasPhoto ? (
        <button
          type="button"
          onClick={retake}
          className="flex h-36 w-full items-center justify-center gap-2 rounded-sm border-2 border-dashed border-border bg-muted text-sm text-muted-foreground transition-colors hover:bg-muted/70"
        >
          <ImageIcon className="size-5" />
          Add Photo
        </button>
      ) : (
        <div>
          <div className="relative">
            {photoUpload.state.status === 'idle' ? (
              <EvidencePhoto photoId={persistedPhotoId} />
            ) : (
              // Tapping the preview retakes, which is what the upload-failure message tells the
              // operator to do. Without the handler that instruction is a dead end, on a gate that
              // blocks submit until a photo lands.
              <img
                src={photoUpload.state.previewUrl}
                alt="Evidence"
                onClick={photoUpload.state.status === 'error' ? retake : undefined}
                className="h-36 w-full rounded-sm object-cover"
              />
            )}
            {photoUpload.state.status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-sm bg-black/50 text-sm font-semibold text-white">
                <Loader2 className="size-4 animate-spin" />
                Uploading...
              </div>
            )}
            <button
              type="button"
              aria-label="Remove photo"
              onClick={handleRemovePhoto}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {photoUpload.state.status === 'error' && (
            <p role="status" className="mt-2 text-xs font-semibold text-destructive">
              {photoUpload.state.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

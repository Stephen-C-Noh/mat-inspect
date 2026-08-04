import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { mediaUploadResponseSchema } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import {
  defaultRetryRuntime,
  HttpAttemptError,
  runWithRetry,
  uploadRetry,
} from '@/lib/retry-policy';

export type PhotoUploadState =
  | { status: 'idle' }
  | { status: 'uploading'; previewUrl: string }
  | { status: 'uploaded'; previewUrl: string; photoId: string }
  | { status: 'error'; previewUrl: string; message: string };

// Uploads as soon as the operator takes the photo, rather than holding the file until submit. A
// blob: URL does not survive a page load, so only an uploaded id can be persisted into the draft
// (DEV-125); uploading eagerly also moves the slow part off the moment the operator submits.
//
// The id is handed to onUploaded the moment it lands, the same way useVoiceNoteRecorder hands out a
// transcript. The caller therefore never has to watch `state` to notice an upload finished: `state`
// drives the preview and nothing else.
export const usePhotoUpload = (
  onUploaded?: (photoId: string) => void,
): {
  state: PhotoUploadState;
  upload: (file: File) => void;
  clear: () => void;
} => {
  const { instance, accounts } = useMsal();
  const [state, setState] = useState<PhotoUploadState>({ status: 'idle' });

  // The live preview URL, mirrored outside React state so the unmount cleanup below can revoke
  // whatever is current. A cleanup that read `state` would capture the state from the render it was
  // registered in, which is always 'idle'.
  const previewUrlRef = useRef<string | null>(null);

  const revokePreview = (): void => {
    if (previewUrlRef.current !== null) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  };

  // Which upload the hook is currently interested in. Bumped by anything that invalidates the one in
  // flight (a retake, a remove, unmount), so a request that finishes afterwards is dropped instead of
  // reporting itself. Without this, removing a photo mid-upload silently undoes itself: the request
  // lands, onUploaded fires, and the id the operator just deleted is written back into the draft.
  const generationRef = useRef(0);

  // The card holding this hook unmounts whenever the operator collapses it or re-marks the item as
  // passing (checklist-item-card), so without this the multi-MB camera blob behind the preview is
  // held for the life of the page. Same class of leak DEV-131 fixed for useObjectUrl. Bumping the
  // generation matters just as much: an upload still in flight must not report a photo for an item
  // whose answer has since changed, which is the ADR 0008 case the checklist screen's reset covers
  // for evidence that already exists.
  useEffect(
    () => () => {
      generationRef.current += 1;
      revokePreview();
    },
    [],
  );

  const upload = (file: File): void => {
    // A retake calls this again before clear(), so the previous preview is revoked here too.
    revokePreview();

    const generation = (generationRef.current += 1);
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setState({ status: 'uploading', previewUrl });

    void (async () => {
      try {
        const photoId = await runWithRetry(
          async () => {
            const accessToken = await acquireAccessToken(instance, accounts);
            const formData = new FormData();
            formData.append('file', file, 'failure.jpg');

            const res = await fetch('/api/v1/media/upload', {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}` },
              body: formData,
            });

            if (!res.ok) throw new HttpAttemptError(res.status);
            return mediaUploadResponseSchema.parse(await res.json()).photoId;
          },
          uploadRetry,
          defaultRetryRuntime,
        );

        if (generationRef.current !== generation) return;
        setState({ status: 'uploaded', previewUrl, photoId });
        onUploaded?.(photoId);
      } catch {
        if (generationRef.current !== generation) return;
        // The operator is standing at the machine and can retake the photo, so this stays a local
        // error on the card (ADR 0025) rather than ending the inspection.
        setState({
          status: 'error',
          previewUrl,
          message: 'Photo upload failed. Tap the photo to try again.',
        });
      }
    })();
  };

  const clear = (): void => {
    generationRef.current += 1;
    revokePreview();
    setState({ status: 'idle' });
  };

  return { state, upload, clear };
};

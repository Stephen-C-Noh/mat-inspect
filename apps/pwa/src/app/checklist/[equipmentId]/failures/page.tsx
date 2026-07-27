'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useMemo, type ReactElement } from 'react';
import { useMsal } from '@azure/msal-react';
import { ChevronRight, ImageIcon, Mic, X, AlertTriangle, Loader2 } from 'lucide-react';
import { mediaUploadResponseSchema } from '@mat-inspect/shared-schemas';
import { AuthGuard } from '@/components/auth-guard';
import { acquireAccessToken } from '@/lib/auth';
import { useInspectionDraftStore } from '@/hooks/use-inspection-draft-store';
import {
  defaultRetryRuntime,
  HttpAttemptError,
  runWithRetry,
  uploadRetry,
} from '@/lib/retry-policy';
import { collectFailedItems, type FailedItem, type FailureDocs } from '@/lib/inspection-submit';
import {
  applyTextEdit,
  applyTranscript,
  clipFilename,
  emptyFailureEntry,
  formatElapsed,
  parseTranscript,
  transcriptionErrorMessage,
  AUDIO_BITS_PER_SECOND,
  MAX_RECORDING_MS,
  type FailureEntry,
} from '@/lib/voice-notes';

function FailureCard({
  failure,
  index,
  total,
  entry,
  onChange,
}: {
  failure: FailedItem;
  index: number;
  total: number;
  entry: FailureEntry;
  // An updater, not a value: a transcript can land after the operator has typed into the field, and
  // a snapshot taken when recording started would overwrite what they wrote.
  onChange: (update: (prev: FailureEntry) => FailureEntry) => void;
}): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const { instance, accounts } = useMsal();

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const capRef = useRef<number | null>(null);

  // Voice is biometric PII under FOIP. Leaving the tracks live keeps the microphone open (and the
  // browser and OS recording indicators lit) after the operator believes recording ended.
  const releaseMicrophone = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearTimers = () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (capRef.current !== null) window.clearTimeout(capRef.current);
    tickRef.current = null;
    capRef.current = null;
  };

  useEffect(() => {
    // Navigating away mid-recording must release the microphone too. The onstop handler is dropped
    // first: an operator leaving the screen is not asking for a transcript.
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      if (capRef.current !== null) window.clearTimeout(capRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Uploads as soon as the operator takes the photo, rather than holding the file until submit.
  // Two reasons. A blob: URL does not survive a page load, so only an uploaded id can be persisted
  // into the draft (DEV-125). And it moves the slow part of submitting off the moment the operator
  // is waiting on, so the final POST is one small JSON request.
  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    onChange((prev) => ({
      ...prev,
      photo: url,
      photoId: null,
      photoError: null,
      isUploadingPhoto: true,
    }));

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

      onChange((prev) => ({ ...prev, photoId, isUploadingPhoto: false }));
    } catch {
      // The operator is standing at the machine and can retake the photo, so this stays a local
      // error on the card (ADR 0025) rather than ending the inspection.
      onChange((prev) => ({
        ...prev,
        isUploadingPhoto: false,
        photoError: 'Photo upload failed. Tap the photo to try again.',
      }));
    }
  };

  // Sends the clip to core-api, which forwards it to the AI Service on the internal network. The
  // AI Service is not reachable from the browser (ADR 0019).
  const sendAudioToAIService = async (clip: Blob, mimeType: string) => {
    setIsTranscribing(true);
    setVoiceError(null);

    try {
      const accessToken = await acquireAccessToken(instance, accounts);

      const formData = new FormData();
      // The field name is fixed by the core-api contract. Content-Type is left to the browser: it
      // carries the multipart boundary, and core-api forwards the header to the AI Service verbatim.
      formData.append('clip', clip, clipFilename(mimeType));

      const res = await fetch('/api/v1/ai/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      if (!res.ok) {
        setVoiceError(transcriptionErrorMessage(res.status));
        return;
      }

      const text = parseTranscript(await res.json());
      if (text.trim().length === 0) {
        // A 200 with nothing in it. Say so, rather than stopping the spinner over an unchanged field
        // and leaving the operator to guess.
        setVoiceError(transcriptionErrorMessage(400));
        return;
      }

      onChange((prev) => applyTranscript(prev, text));
    } catch {
      // Transcription never blocks an inspection (ADR 0017): the note field stays typable either way.
      setVoiceError(transcriptionErrorMessage('network'));
    } finally {
      setIsTranscribing(false);
    }
  };

  // Reads the recorder's state rather than isRecording, because the recording cap fires this from a
  // closure captured before isRecording was ever true.
  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearTimers();
    setIsRecording(false);
  };

  const startRecording = async () => {
    setVoiceError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError(transcriptionErrorMessage('microphone'));
      return;
    }

    // The recorder picks its own container (WebM/Opus on Chrome and Android, mp4 on iOS Safari), so
    // the clip is labelled with recorder.mimeType below rather than an assumed type. The bitrate is
    // set explicitly to keep a capped recording well under the 10 MB the AI Service accepts.
    const recorder = new MediaRecorder(stream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    streamRef.current = stream;
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      releaseMicrophone();
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      if (chunks.length === 0) return;
      void sendAudioToAIService(new Blob(chunks, { type: recorder.mimeType }), recorder.mimeType);
    };

    const startedAt = Date.now();
    recorder.start();
    setIsRecording(true);
    setElapsedMs(0);

    tickRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    // Auto-stop at the cap. Without it the operator can record past what the AI Service accepts and
    // learn about it only after the upload (a 413).
    capRef.current = window.setTimeout(stopRecording, MAX_RECORDING_MS);
  };

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
      <div className="border-l-4 border-warning p-4 space-y-4">
        <div>
          <p className="text-xs font-bold text-warning mb-0.5">
            Failure {index + 1} of {total}
          </p>
          <h3 className="text-base font-extrabold text-foreground">{failure.prompt}</h3>
        </div>

        {/* Photo */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence Photo
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhoto}
          />
          {entry.photo || entry.photoId ? (
            <div className="relative">
              {entry.photo ? (
                <img
                  src={entry.photo}
                  alt="Evidence"
                  className="h-40 w-full rounded-sm object-cover"
                />
              ) : (
                // Restored from the draft after a page load. The uploaded photo is safe on the
                // server, but its blob: URL is gone, so say so rather than showing a broken image.
                <div className="flex h-40 w-full items-center justify-center gap-2 rounded-sm border border-border bg-muted text-sm text-muted-foreground">
                  <ImageIcon className="size-5" />
                  Photo attached
                </div>
              )}
              {entry.isUploadingPhoto && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-sm bg-black/50 text-sm font-semibold text-white">
                  <Loader2 className="size-4 animate-spin" />
                  Uploading...
                </div>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() =>
                  onChange((prev) => ({
                    ...prev,
                    photo: null,
                    photoId: null,
                    photoError: null,
                  }))
                }
                className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-36 w-full items-center justify-center gap-2 rounded-sm border-2 border-dashed border-border bg-muted text-sm text-muted-foreground hover:bg-muted/70 transition-colors"
            >
              <ImageIcon className="size-5" />
              Tap to add photo
            </button>
          )}
          {entry.photoError && (
            <p role="status" className="mt-2 text-xs font-semibold text-destructive">
              {entry.photoError}
            </p>
          )}
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Description of Failure
        </p>

        <div className="relative">
          <textarea
            rows={3}
            placeholder="Describe the defect observed..."
            value={entry.notes}
            onChange={(e) => onChange((prev) => applyTextEdit(prev, e.target.value))}
            className="w-full resize-none rounded-sm border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isTranscribing && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-background/90 px-1.5 py-0.5 rounded text-[11px] font-medium text-primary">
              <Loader2 className="size-3 animate-spin" />
              Transcribing...
            </div>
          )}

          {voiceError && (
            <p role="status" className="mb-2 text-xs font-semibold text-warning">
              {voiceError}
            </p>
          )}

          <div className="mb-2">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              className={`flex w-full items-center justify-center gap-2 rounded-sm py-3 text-sm font-bold shadow-card transition-colors disabled:opacity-60 ${
                isRecording
                  ? 'bg-red-600 text-white animate-pulse hover:bg-red-700'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              <Mic className="size-4" />
              {isRecording
                ? `Stop Recording ${formatElapsed(elapsedMs)} / ${formatElapsed(MAX_RECORDING_MS)}`
                : 'Add Voice Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FailuresContent(): ReactElement {
  const params = useParams<{ equipmentId: string }>();
  const router = useRouter();

  // The answers come from the persisted draft, so a page load on this screen restores the whole
  // inspection instead of discarding it (DEV-125). A null draft now means what it says: no
  // inspection is in progress for this machine, so send the operator back to start one.
  const { restored: draft, save } = useInspectionDraftStore(params.equipmentId);

  const failedItems = useMemo(
    () => (draft ? collectFailedItems(draft.items, draft.answers) : []),
    [draft],
  );

  useEffect(() => {
    if (!draft) router.replace(`/inspect/${params.equipmentId}`);
  }, [draft, params.equipmentId, router]);

  // Seeded from the draft's failureDocs, so defect notes and uploaded evidence survive a page load
  // alongside the answers. The photo thumbnail does not: only the uploaded id is persisted.
  const [entries, setEntries] = useState<Record<string, FailureEntry>>(() => {
    const seeded: Record<string, FailureEntry> = {};
    for (const [itemKey, doc] of Object.entries(draft?.failureDocs ?? {})) {
      seeded[itemKey] = {
        ...emptyFailureEntry(),
        notes: doc.notes,
        notesSource: doc.notesSource,
        photoId: doc.photoIds[0] ?? null,
      };
    }
    return seeded;
  });

  // Seed one entry per failed item once the list is known, keyed by item key.
  useEffect(() => {
    setEntries((prev) => {
      const next: Record<string, FailureEntry> = {};
      for (const item of failedItems) {
        next[item.itemKey] = prev[item.itemKey] ?? emptyFailureEntry();
      }
      return next;
    });
  }, [failedItems]);

  // Write defect notes and uploaded photo ids back into the draft as the operator records them.
  useEffect(() => {
    if (!draft) return;
    const failureDocs: FailureDocs = {};
    for (const [itemKey, entry] of Object.entries(entries)) {
      failureDocs[itemKey] = {
        notes: entry.notes,
        notesSource: entry.notesSource,
        photoIds: entry.photoId ? [entry.photoId] : [],
      };
    }
    save({ ...draft, failureDocs });
  }, [entries, draft, save]);

  // Photos are uploaded at capture, so the gate is an uploaded id rather than a local file. An
  // upload still in flight or failed therefore holds submit, which is what the operator expects
  // from a screen that requires evidence.
  const allPhotosAttached =
    failedItems.length > 0 && failedItems.every((item) => entries[item.itemKey]?.photoId != null);

  const updateEntry = (id: string, update: (prev: FailureEntry) => FailureEntry) => {
    setEntries((prev) => ({ ...prev, [id]: update(prev[id] ?? emptyFailureEntry()) }));
  };

  // Documentation is finished here; nothing is recorded. The defect notes and uploaded photo ids
  // are already in the draft (the effect above writes them as the operator records them), so this
  // only hands off to the review screen, where the operator sees the summary and attests
  // (ADR 0007). The POST lives there, on both the clean and the fail path.
  const handleReview = (): void => {
    if (!draft || !allPhotosAttached) return;

    const failureDocs: FailureDocs = {};
    for (const item of failedItems) {
      const entry = entries[item.itemKey]!;
      failureDocs[item.itemKey] = {
        notes: entry.notes,
        notesSource: entry.notesSource,
        photoIds: entry.photoId ? [entry.photoId] : [],
      };
    }
    save({ ...draft, failureDocs });

    router.push(`/checklist/${params.equipmentId}/review`);
  };

  if (!draft) return <></>;

  return (
    <main className="min-h-screen bg-muted pb-32">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-sm p-1.5 hover:bg-primary-foreground/10 transition-colors"
          aria-label="Go back"
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="text-sm font-extrabold uppercase tracking-wide">Document Failures</span>
      </header>

      <div className="mx-auto max-w-lg space-y-4 px-4 pt-4">
        <div className="flex items-center gap-2 rounded-sm border border-warning/30 bg-warning/10 px-3 py-2.5">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <p className="text-xs font-semibold text-warning">
            Document all failures before submitting. The chair holder will be notified
            automatically.
          </p>
        </div>

        {failedItems.map((f, i) => (
          <FailureCard
            key={f.itemKey}
            failure={f}
            index={i}
            total={failedItems.length}
            entry={entries[f.itemKey] ?? emptyFailureEntry()}
            onChange={(update) => updateEntry(f.itemKey, update)}
          />
        ))}
      </div>

      {/* Reverted back to fixed positioning to match DEV-100 */}
      <div className="fixed inset-x-0 bottom-4 mx-auto max-w-lg px-4 space-y-2">
        <button
          type="button"
          disabled={!allPhotosAttached}
          onClick={handleReview}
          className={`w-full rounded-sm py-4 text-sm font-bold shadow-card transition-colors ${
            allPhotosAttached
              ? 'bg-warning text-warning-foreground'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          {allPhotosAttached ? 'Review and Submit' : 'Attach all photos to continue'}
        </button>

        <Link href={`/inspect/${params.equipmentId}`} className="block">
          <button
            type="button"
            className="w-full rounded-sm border border-border bg-card py-3 text-sm font-semibold text-muted-foreground shadow-card"
          >
            Back to Checklist
          </button>
        </Link>
      </div>
    </main>
  );
}

export default function FailuresPage(): ReactElement {
  return (
    <AuthGuard>
      <FailuresContent />
    </AuthGuard>
  );
}

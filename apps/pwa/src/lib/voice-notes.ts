// Voice defect notes (DEV-34). The transcript is assistive only: the operator reads it, edits it,
// and owns the result (OHS s.257). What ends up on the audit trail is the note text plus a
// notesSource saying where it came from, so the rules that decide notesSource live here as pure
// functions rather than inside the component that renders them.

export type NotesSource = 'TYPED' | 'VOICE_TRANSCRIBED' | 'VOICE_EDITED';

export type FailureEntry = {
  // A blob: URL for the thumbnail. Session-only and deliberately not persisted: the browser revokes
  // it on unload, so a restored draft would hold a reference fetch() cannot read (DEV-125).
  photo: string | null;
  // The Media Service id, set once the photo has been uploaded. This is what the draft persists and
  // what the submit payload carries (ADR 0023).
  photoId: string | null;
  photoError: string | null;
  isUploadingPhoto: boolean;
  notes: string;
  notesSource: NotesSource;
  mediaRef?: string | null;
  // The exact machine output, when the note is still exactly that. Null once the note is a mix of
  // typed and transcribed text, which no later edit can undo.
  rawTranscript: string | null;
};

export const emptyFailureEntry = (): FailureEntry => ({
  notes: '',
  photo: null,
  photoId: null,
  photoError: null,
  isUploadingPhoto: false,
  notesSource: 'TYPED',
  rawTranscript: null,
});

// The AI Service caps a clip at 10 MB and rejects it on the declared Content-Length before reading
// the body (ADR 0019). Recording at 32 kbps, which is ample for speech, 2 minutes is roughly 480 KB:
// far enough under the cap that the operator never records into a 413. A defect note is a sentence,
// not a monologue, so the cap doubles as a nudge.
export const MAX_RECORDING_MS = 120_000;
export const AUDIO_BITS_PER_SECOND = 32_000;

// MediaRecorder chooses its own container: WebM/Opus on Chrome and Android, mp4 on iOS Safari. Ask
// the recorder what it produced rather than asserting a type it may not be in. core-api forwards
// this label to the AI Service verbatim, so a wrong one is a wrong one all the way down.
export const clipFilename = (mimeType: string): string => {
  const subtype = mimeType.split(';')[0]?.split('/')[1] ?? '';
  return `clip.${subtype || 'webm'}`;
};

// core-api answers 200 with { text }. Anything else is treated as no transcript rather than trusted
// into the note field, which is what `data.text || ''` did.
export const parseTranscript = (payload: unknown): string => {
  if (typeof payload !== 'object' || payload === null) return '';
  const { text } = payload as { text?: unknown };
  return typeof text === 'string' ? text : '';
};

export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

// Transcription never blocks an inspection (ADR 0017), so every failure below is soft: the note
// field stays typable. But soft is not silent. The operator has to be able to tell "the model heard
// nothing" from "the service is down", or they retry a recording that was never going to work.
// The statuses are the ones core-api passes through from the AI Service.
export const transcriptionErrorMessage = (status: number | 'network' | 'microphone'): string => {
  if (status === 'microphone')
    return 'Microphone unavailable. Check permissions and type the note.';
  switch (status) {
    case 400:
      return 'No speech detected in the recording. Try again, or type the note.';
    case 413:
      return 'Recording is too long to transcribe. Record a shorter note, or type it.';
    case 429:
      return 'Transcription is busy. Try again in a moment, or type the note.';
    default:
      return 'Transcription unavailable. Type the note instead.';
  }
};

// A transcript never destroys text the operator already has. If they typed while transcription was
// in flight, or a first recording is already in the field, the new text is appended. Only an empty
// field takes the transcript as the whole note, and only then is the note pure machine output.
//
// An empty or whitespace-only transcript changes nothing. Recording silence must not clear the
// field, which is what `data.text || ''` written straight into notes used to do.
export const applyTranscript = (prev: FailureEntry, transcript: string): FailureEntry => {
  const text = transcript.trim();
  if (text.length === 0) return prev;

  const existing = prev.notes.trim();
  if (existing.length === 0) {
    return { ...prev, notes: text, notesSource: 'VOICE_TRANSCRIBED', rawTranscript: text };
  }

  // Appended to text that was already there, so the note is no longer anything a machine said on its
  // own. rawTranscript is dropped: there is no original for a later edit to return to.
  return {
    ...prev,
    notes: `${existing} ${text}`,
    notesSource: 'VOICE_EDITED',
    rawTranscript: null,
  };
};

// Editing a transcript back to the exact machine output restores VOICE_TRANSCRIBED. That is
// deliberate: notesSource records what the stored text is, not what the operator did on the way
// there, and the stored text really is the untouched machine output. A note that was never
// transcribed stays TYPED no matter what is typed into it.
export const applyTextEdit = (prev: FailureEntry, text: string): FailureEntry => {
  if (prev.notesSource === 'TYPED') return { ...prev, notes: text };

  const notesSource: NotesSource =
    prev.rawTranscript !== null && text === prev.rawTranscript
      ? 'VOICE_TRANSCRIBED'
      : 'VOICE_EDITED';

  return { ...prev, notes: text, notesSource };
};

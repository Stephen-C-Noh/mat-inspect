'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, useRef, type ReactElement } from 'react';
import { ChevronRight, ImageIcon, Mic, X, AlertTriangle, Loader2 } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';

const MOCK_FAILURES = [
  { id: '1', question: 'Tire Condition & Pressure?' },
  { id: '2', question: 'Brake Functionality?' },
];

// Tracks the origin of a defect note for audit compliance (OHS s.257).
type NotesSource = 'TYPED' | 'VOICE_TRANSCRIBED' | 'VOICE_EDITED';

type FailureEntry = {
  notes: string;
  photo: string | null;
  notes_source: NotesSource;
};

function FailureCard({
  failure,
  index,
  total,
  entry,
  onChange,
}: {
  failure: (typeof MOCK_FAILURES)[0];
  index: number;
  total: number;
  entry: FailureEntry;
  onChange: (updated: FailureEntry) => void;
}): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);

  // Audio capture and background tracking states
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Retains original text to determine if modifications have occurred
  const rawTranscriptRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onChange({ ...entry, photo: url });
  };

  // Handles starting the microphone recording interface
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        sendAudioToAIService(audioBlob);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch {
      // Audio interface access denied or missing configuration
    }
  };

  // Stops microphone recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Sends audio payload matching the backend configuration parameters
  const sendAudioToAIService = async (audioBlob: Blob) => {
    setIsTranscribing(true);

    try {
      const formData = new FormData();
      // Matches backend contract: parameter must be exactly 'clip'
      formData.append('clip', audioBlob, 'clip.wav');

      const response = await fetch('/api/v1/ai/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const incomingText = data.text || ''; // Matches exact response schema: { text: string }

        rawTranscriptRef.current = incomingText;

        onChange({
          ...entry,
          notes: incomingText,
          notes_source: 'VOICE_TRANSCRIBED',
        });
      } else {
        // Soft failure fallback (413/429/503 respond silently to allow typing)
      }
    } catch {
      // AI Service communication soft-failure handled cleanly in background
    } finally {
      setIsTranscribing(false);
    }
  };

  // Dynamically alters notes_source flag if user edits a voice transcription
  const handleTextChange = (textValue: string) => {
    let nextSource: NotesSource = 'TYPED';

    if (entry.notes_source === 'VOICE_TRANSCRIBED' || entry.notes_source === 'VOICE_EDITED') {
      nextSource = textValue === rawTranscriptRef.current ? 'VOICE_TRANSCRIBED' : 'VOICE_EDITED';
    }

    onChange({
      ...entry,
      notes: textValue,
      notes_source: nextSource,
    });
  };

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
      <div className="border-l-4 border-warning p-4 space-y-4">
        <div>
          <p className="text-xs font-bold text-warning mb-0.5">
            Failure {index + 1} of {total}
          </p>
          <h3 className="text-base font-extrabold text-foreground">{failure.question}</h3>
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
          {entry.photo ? (
            <div className="relative">
              <img
                src={entry.photo}
                alt="Evidence"
                className="h-40 w-full rounded-sm object-cover"
              />
              <button
                type="button"
                onClick={() => onChange({ ...entry, photo: null })}
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
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Description of Failure
        </p>

        <div className="relative">
          <textarea
            rows={3}
            placeholder="Describe the defect observed..."
            value={entry.notes}
            onChange={(e) => handleTextChange(e.target.value)}
            className="w-full resize-none rounded-sm border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {/* Visual background indicator during API processing loops */}
          {isTranscribing && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-background/90 px-1.5 py-0.5 rounded text-[11px] font-medium text-primary">
              <Loader2 className="size-3 animate-spin" />
              Transcribing...
            </div>
          )}

          {/* Notes */}
          <div className="mb-2">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              className={`flex w-full items-center justify-center gap-2 rounded-sm py-3 text-sm font-bold shadow-card transition-colors ${
                isRecording
                  ? 'bg-red-600 text-white animate-pulse hover:bg-red-700'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              <Mic className="size-4" />
              {isRecording ? 'Stop Recording' : 'Add Voice Note'}
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

  // Initialize the state container mapping each mock failure to a clean default state
  const [entries, setEntries] = useState<Record<string, FailureEntry>>(
    Object.fromEntries(
      MOCK_FAILURES.map((f) => [
        f.id,
        {
          notes: '',
          photo: null,
          notes_source: 'TYPED', // Defaults to TYPED until a voice capture is initiated
        },
      ]),
    ),
  );

  const updateEntry = (id: string, updated: FailureEntry) => {
    setEntries((prev) => ({ ...prev, [id]: updated }));
  };

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

        {MOCK_FAILURES.map((f, i) => (
          <FailureCard
            key={f.id}
            failure={f}
            index={i}
            total={MOCK_FAILURES.length}
            entry={entries[f.id]!}
            onChange={(updated) => updateEntry(f.id, updated)}
          />
        ))}
      </div>

      {/* Fixed submit */}
      <div className="fixed inset-x-4 bottom-4 mx-auto max-w-xl space-y-2">
        <Link href={`/checklist/${params.equipmentId}/submitted/fail`} className="block">
          <button
            type="button"
            className="w-full rounded-sm bg-warning py-4 text-sm font-bold text-warning-foreground shadow-card"
          >
            Submit Inspection with Failures
          </button>
        </Link>
        <Link href={`/checklist/${params.equipmentId}/submitted`} className="block">
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

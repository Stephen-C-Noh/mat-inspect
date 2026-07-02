'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, useRef, type ReactElement } from 'react';
import { ChevronRight, ImageIcon, Mic, X, AlertTriangle } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';

const MOCK_FAILURES = [
  { id: '1', question: 'Tire Condition & Pressure?' },
  { id: '2', question: 'Brake Functionality?' },
];

type FailureEntry = {
  notes: string;
  photo: string | null;
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

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onChange({ ...entry, photo: url });
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

        {/* Notes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description of Failure
            </p>
            <button
              type="button"
              disabled
              title="Voice input coming soon"
              className="flex items-center gap-1 rounded-sm bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground opacity-50 cursor-not-allowed"
            >
              <Mic className="size-3.5" />
              Voice
            </button>
          </div>
          <textarea
            rows={3}
            placeholder="Describe the defect observed..."
            value={entry.notes}
            onChange={(e) => onChange({ ...entry, notes: e.target.value })}
            className="w-full resize-none rounded-sm border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}

function FailuresContent(): ReactElement {
  const params = useParams<{ equipmentId: string }>();
  const router = useRouter();

  const [entries, setEntries] = useState<Record<string, FailureEntry>>(
    Object.fromEntries(MOCK_FAILURES.map((f) => [f.id, { notes: '', photo: null }])),
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

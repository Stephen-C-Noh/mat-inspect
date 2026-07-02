'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, type ReactElement } from 'react';
import {
  CheckCircle,
  Home,
  History,
  RotateCcw,
  Forklift,
  AlertTriangle,
  ImageIcon,
} from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '@/hooks/use-equipment';

const MOCK_FAILURES = [
  {
    id: '1',
    question: 'Tire Condition & Pressure?',
    description:
      '"Flat tire observed on forklift. Tire has low/no air pressure and requires repair or replacement before safe operation"',
  },
  {
    id: '2',
    question: 'Brake Functionality?',
    description: '"Breaks do not work as intended"',
  },
];

function FailureCard({
  failure,
  index,
  total,
}: {
  failure: (typeof MOCK_FAILURES)[0];
  index: number;
  total: number;
}): ReactElement {
  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
      <div className="border-l-4 border-warning p-4">
        <p className="mb-1 text-xs font-bold text-warning">
          Failure {index + 1} of {total}
        </p>
        <h3 className="text-base font-extrabold text-foreground">{failure.question}</h3>

        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence Photo
          </p>
          <div className="flex h-36 items-center justify-center rounded-sm bg-muted">
            <ImageIcon className="size-8 text-muted-foreground" />
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description of Failure
          </p>
          <p className="text-sm italic text-muted-foreground">{failure.description}</p>
        </div>
      </div>
    </div>
  );
}

function SubmittedFailContent(): ReactElement {
  const params = useParams<{ equipmentId: string }>();
  const { accounts } = useMsal();
  const { data: equipmentList } = useEquipmentList();

  const equipment = useMemo(
    () => equipmentList?.find((e) => e.id === params.equipmentId),
    [equipmentList, params.equipmentId],
  );

  const timestamp =
    new Date().toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' · ' +
    new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });

  const inspectorName = accounts[0]?.name ?? 'MAT Lab Tech';

  return (
    <main className="min-h-screen bg-muted px-4 py-8">
      <div className="mx-auto max-w-lg space-y-6">
        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 pt-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning">
            <CheckCircle className="size-10 text-warning-foreground" strokeWidth={2.5} />
          </div>
          <h1 className="text-center text-2xl font-extrabold text-foreground">
            Inspection{'\n'}Submitted
          </h1>
          <span className="flex items-center gap-1.5 rounded-full bg-warning px-4 py-1.5 text-xs font-bold text-warning-foreground">
            <AlertTriangle className="size-3.5" />
            CHAIR HOLDERS NOTIFIED
          </span>
        </div>

        {/* Equipment card */}
        <div className="rounded-sm border border-border bg-card p-4 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-warning">
                Equipment
              </p>
              <p className="text-lg font-extrabold text-foreground">
                {equipment?.name ?? 'Forklift #3'}
              </p>
            </div>
            <Forklift className="mt-1 size-5 text-muted-foreground" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-y-1 border-t border-border pt-3 text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className="text-right text-muted-foreground">Timestamp</span>
            <span className="flex items-center gap-1 font-semibold text-success">
              <CheckCircle className="size-3.5" /> Completed
            </span>
            <span className="text-right text-xs font-medium text-foreground">{timestamp}</span>
          </div>

          <div className="mt-3 border-t border-border pt-3 text-sm">
            <p className="text-muted-foreground">Inspector</p>
            <p className="font-semibold text-foreground">{inspectorName}</p>
          </div>
        </div>

        {/* Failure cards */}
        {MOCK_FAILURES.map((f, i) => (
          <FailureCard key={f.id} failure={f} index={i} total={MOCK_FAILURES.length} />
        ))}

        {/* Actions */}
        <div className="space-y-3">
          <Link href="/" className="block">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-sm bg-primary py-4 text-sm font-bold text-primary-foreground"
            >
              <Home className="size-4" />
              Return to Home
            </button>
          </Link>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/" className="block">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-card py-3.5 text-sm font-semibold text-foreground"
              >
                <History className="size-4" />
                View History
              </button>
            </Link>
            <Link href="/scan" className="block">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-card py-3.5 text-sm font-semibold text-foreground"
              >
                <RotateCcw className="size-4" />
                New Inspection
              </button>
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Submission reference #777-TX-2025
        </p>
      </div>
    </main>
  );
}

export default function SubmittedFailPage(): ReactElement {
  return (
    <AuthGuard>
      <SubmittedFailContent />
    </AuthGuard>
  );
}

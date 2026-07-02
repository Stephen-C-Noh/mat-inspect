'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useEquipmentById } from '@/hooks/use-equipment-by-id';

function LockoutContent() {
  const { equipmentId } = useParams<{ equipmentId: string }>();
  const searchParams = useSearchParams();

  // Equipment identity comes from the server, not from URL params. This is the source of
  // truth and stops anyone from fabricating a lockout tag for arbitrary name/tag values.
  const { data: equipment, isPending, isError } = useEquipmentById(equipmentId);

  const equipmentName = isPending
    ? 'Loading equipment…'
    : isError
      ? 'Equipment (identity unavailable)'
      : (equipment?.name ?? 'Equipment Asset');
  const assetTag = equipment?.assetTag ?? (isPending ? '…' : 'N/A');

  // Blocking defects come from the inspection that just failed. There is no endpoint to
  // fetch them after the fact (the submit response carries no defect labels), so the submit
  // flow passes them here as repeated `defect` keys (?defect=A&defect=B). getAll() avoids
  // splitting a voice-transcribed note that itself contains a comma into several entries.
  const passedDefects = searchParams.getAll('defect');
  const blockingDefects =
    passedDefects.length > 0 ? passedDefects : ['Critical safety compliance violation'];

  // Lockout time is when the inspection failed, not when this page renders. Passed as
  // an ISO string (inspection submittedAt). If absent, show Unknown rather than
  // fabricate a render-time value on a compliance-relevant tag.
  const lockedAtParam = searchParams.get('lockedAt');
  const lockedAt = lockedAtParam ? new Date(lockedAtParam) : null;
  const lockedAtLabel =
    lockedAt && !Number.isNaN(lockedAt.getTime()) ? lockedAt.toLocaleString() : 'Unknown';

  // --- HARD UI NAVIGATION LOCKOUT TRAP ---
  useEffect(() => {
    // Overrides popstate to forcefully re-push current page state
    window.history.pushState(null, '', window.location.href);

    const lockViewport = () => {
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', lockViewport);
    return () => window.removeEventListener('popstate', lockViewport);
  }, []);

  return (
    <main className="min-h-screen bg-muted p-4 flex flex-col justify-center items-center">
      {/* Container Card */}
      <div className="w-full max-w-xl bg-background border-2 border-destructive rounded-sm shadow-card overflow-hidden">
        {/* High-Visibility Destructive Warning Header */}
        <div className="bg-destructive text-destructive-foreground p-6 text-center space-y-2">
          <div className="text-4xl font-extrabold tracking-tighter uppercase">Do Not Operate</div>
          <p className="text-xs font-bold uppercase tracking-widest opacity-90">
            Digital Lockout Enforced
          </p>
        </div>

        <div className="p-4 space-y-6">
          {/* Equipment Profile Section */}
          <div className="border-b border-border pb-4 space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Asset Profile
            </p>
            <h1 className="text-2xl font-extrabold text-foreground">{equipmentName}</h1>
            <div className="pt-2">
              <span className="inline-block rounded-lg bg-muted border border-border px-3 py-1 text-xs font-bold text-foreground">
                Asset Tag: {assetTag}
              </span>
            </div>
          </div>

          {/* Timestamp Container */}
          <div className="bg-muted border border-border p-3 rounded-md flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Lockout Timestamp
            </span>
            <span className="text-sm font-semibold text-foreground">{lockedAtLabel}</span>
          </div>

          {/* Blocking Defects Display */}
          <div className="space-y-2">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-destructive">
              Critical Defects Found
            </h2>

            <ul className="space-y-2" role="list">
              {blockingDefects.map((defect, index) => (
                <li
                  key={index}
                  // used text-foreground to pass WCAG 2.1 AA accessibility guidelines
                  className="bg-destructive/10 border-l-4 border-destructive rounded-r-md p-3 text-foreground text-sm font-bold"
                >
                  <span className="text-destructive mr-1" aria-hidden="true">
                    ⚠️
                  </span>{' '}
                  {defect}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Footer warning */}
      <p className="text-center text-[11px] font-semibold text-muted-foreground mt-4 max-w-xs px-4">
        This device has failed required safety limits. Navigation is restricted. A supervisor key or
        clearance log is required to reset this layout.
      </p>
    </main>
  );
}

export default function LockoutPage() {
  // useSearchParams() must sit under a Suspense boundary, otherwise `next build`
  // fails prerendering this route (output: 'standalone' prerenders by default).
  return (
    <Suspense fallback={null}>
      <LockoutContent />
    </Suspense>
  );
}

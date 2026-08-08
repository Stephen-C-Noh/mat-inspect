'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEquipmentById } from '@/hooks/use-equipment-by-id';

function LockoutContent() {
  const { equipmentId } = useParams<{ equipmentId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Equipment identity comes from the server, not from URL params. This is the source of
  // truth and stops anyone from fabricating a lockout tag for arbitrary name/tag values.
  const { data: equipment, isPending, isError } = useEquipmentById(equipmentId);

  const equipmentName = isPending
    ? 'Loading equipment…'
    : isError
      ? 'Equipment (identity unavailable)'
      : (equipment?.name ?? 'Equipment Asset');
  const assetTag = equipment?.assetTag ?? (isPending ? '…' : 'N/A');

  // Which reason this screen states (DEV-143). RETIRED equipment has no failed inspection behind
  // this screen and no return-to-service cycle, so the FAIL_BLOCKING copy (a fabricated "Critical
  // safety compliance violation" defect, an RTS instruction) would misdescribe why it is
  // unavailable. Read from the fetched equipment row, not a `?reason=` query param: this screen's
  // own rule (equipment identity comes from the server, not client-supplied URL params, so a tag
  // cannot be fabricated) applies here too. A query flag would let anyone spoof either direction:
  // paste `?reason=retired` onto a merely-OUT_OF_SERVICE unit's URL to hide its real defects, or
  // reach this screen for a RETIRED unit with no `reason` param (bookmark, shared link, history)
  // and get the fabricated defect back.
  //
  // 'unknown' is the third case, and the reason this is not a boolean: the status can be pending,
  // or the fetch can fail outright (use-equipment-by-id sets retry: false, so one offline read
  // settles it), and a two-way split makes the lockout copy the default for both. That put the
  // fabricated defect and the RTS instruction back on the screen for a retired unit whenever its
  // status did not load. State no reason at all rather than the wrong one; "Do Not Operate" stands
  // either way, since that is the safe reading of an unknown status (code review on DEV-143).
  //
  // A loaded status that is neither lockout state (READY or AWAITING_INSPECTION, for example a
  // supervisor completed return-to-service between the failing submit and this screen loading, or
  // this URL is a stale bookmark) is not 'unknown' either: it is a confirmed answer that this is
  // not a lockout tag, and showing "Do Not Operate" for equipment the server says is available
  // would be actively wrong, not just uninformative (code review on DEV-143). Handled as a
  // redirect below rather than a fourth copy variant, since there is nothing this screen should
  // ever tell the operator about equipment that is not locked out.
  const isAvailable = equipment?.status === 'READY' || equipment?.status === 'AWAITING_INSPECTION';

  const variant: 'retired' | 'lockout' | 'unknown' =
    equipment?.status === 'RETIRED'
      ? 'retired'
      : equipment?.status === 'OUT_OF_SERVICE'
        ? 'lockout'
        : 'unknown';

  useEffect(() => {
    if (isAvailable) router.replace('/');
  }, [isAvailable, router]);

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
  // Must not engage until the equipment read has resolved and confirmed the unit is not
  // available (Copilot review on PR #133): engaging it during the pending render, then
  // redirecting once the status turns out to be READY/AWAITING_INSPECTION, leaves the pushed
  // history entry behind. Back would land on this route again, bounce straight through the
  // isAvailable redirect, and read as a flash back onto the very screen the trap exists to
  // keep the operator off of.
  useEffect(() => {
    if (isPending || isAvailable) return;

    // Overrides popstate to forcefully re-push current page state
    window.history.pushState(null, '', window.location.href);

    const lockViewport = () => {
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', lockViewport);
    return () => window.removeEventListener('popstate', lockViewport);
  }, [isPending, isAvailable]);

  // Redirecting away (the effect above); render nothing rather than flash the lockout card for
  // equipment the server just confirmed is not locked out.
  if (isAvailable) return null;

  return (
    <main className="min-h-screen bg-muted p-4 flex flex-col justify-center items-center">
      {/* Container Card */}
      <div className="w-full max-w-xl bg-background border-2 border-destructive rounded-sm shadow-card overflow-hidden">
        {/* High-Visibility Destructive Warning Header */}
        <div className="bg-destructive text-destructive-foreground p-6 text-center space-y-2">
          <div className="text-4xl font-extrabold tracking-tighter uppercase">Do Not Operate</div>
          <p className="text-xs font-bold uppercase tracking-widest opacity-90">
            {variant === 'retired'
              ? 'Equipment Retired'
              : variant === 'lockout'
                ? 'Digital Lockout Enforced'
                : 'Status Unavailable'}
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

          {variant === 'lockout' && (
            <>
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
            </>
          )}

          {variant === 'retired' && (
            <p className="text-sm font-semibold text-foreground">
              This equipment has been permanently retired from service. It has no open defect and no
              return-to-service cycle applies; it cannot be inspected again.
            </p>
          )}

          {variant === 'unknown' && (
            <p className="text-sm font-semibold text-foreground">
              {isPending
                ? 'Loading this equipment’s current status…'
                : 'The reason this equipment is unavailable could not be confirmed.'}
            </p>
          )}
        </div>
      </div>

      {/* Footer warning */}
      <p className="text-center text-[11px] font-semibold text-muted-foreground mt-4 max-w-xs px-4">
        {variant === 'retired'
          ? 'If this equipment should still be in service, contact a supervisor to review its status.'
          : variant === 'lockout'
            ? 'This equipment failed a required safety inspection and is locked out. A supervisor must resolve the defect and approve return-to-service before it can be inspected again.'
            : 'Contact a supervisor to confirm this equipment’s status before operating it.'}
      </p>

      {/* Escape hatch: this screen has no browser-back path (the trap below exists so a fresh
          FAIL_BLOCKING submit cannot be backed into and resubmitted), and it is now also reached
          by browsing directly to already-locked-out or retired equipment, not only right after a
          failing submit. Without a forward path an operator who lands here has no way off the
          screen short of force-closing the installed PWA (code review on DEV-143). */}
      <button
        type="button"
        onClick={() => router.push('/')}
        className="mt-6 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground shadow-card"
      >
        Back to Equipment List
      </button>
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

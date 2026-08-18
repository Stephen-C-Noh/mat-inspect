'use client';

import { useMsal } from '@azure/msal-react';
import { getActiveAccount } from '@mat-inspect/shared-auth';
import type { DefectCategory } from '@mat-inspect/shared-types';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { useInspectionDraft } from '@/components/inspection-draft-provider';
import { useInspectionDraftStore } from '@/hooks/use-inspection-draft-store';
import { useSubmitInspection } from '@/hooks/use-submit-inspection';
import { useDefectCategorySuggestions } from '@/hooks/use-defect-category-suggestions';
import { attestationSummary, operatorDisplayName } from '@/lib/attestation-summary';
import type { ItemCategory } from '@/lib/defect-category';
import { DefectCategoryPicker } from '@/components/checklist/defect-category-picker';
import {
  buildSubmitPayload,
  collectFailedItems,
  failuresDocumented,
} from '@/lib/inspection-submit';
import { submitErrorMessage } from '@/lib/submit-error-message';

// The review-and-confirm step required by ADR 0007. It is a route rather than a dialog on the
// checklist screen for three reasons: the operator must be able to back out with the browser's
// own back gesture and land on their answers; both submit paths (clean and documented-failure)
// share one attestation surface; and the screen reads only the persisted draft (DEV-125), so it
// does not care which screen the operator came from.
function ReviewView(): ReactElement {
  const params = useParams<{ equipmentId: string }>();
  const router = useRouter();
  const { instance, accounts } = useMsal();
  const { restored: draft, save, clear } = useInspectionDraftStore(params.equipmentId);

  const { setResult } = useInspectionDraft();
  const submitInspection = useSubmitInspection();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One key per attempted submit, kept in the draft so it survives leaving this screen. An
  // operator whose confirm failed can take "Back to Checklist" and come back; a fresh key would
  // turn a POST that reached the server into a second inspection instead of a replayed 201
  // (ADR 0009).
  const idempotencyKeyRef = useRef<string>(draft?.submitIdempotencyKey ?? '');

  const failedItems = useMemo(
    () => (draft ? collectFailedItems(draft.items, draft.answers) : []),
    [draft],
  );

  // Seeded from the draft the same way notes and photoIds are (they live in local state, not
  // read live off `draft`, because useInspectionDraftStore's `restored` never updates after the
  // first render). This is the only screen that writes to it (ADR 0028); the checklist screen
  // carries it through its own save calls unread so it is never clobbered back to empty.
  const [categories, setCategories] = useState<Record<string, ItemCategory>>(
    () => draft?.categories ?? {},
  );

  // Every write from this screen has to carry both fields this screen mutates: the confirmed
  // categories and the submit idempotency key. saveDraft REPLACES the stored record (it does not
  // merge), and `draft` (restored) never updates after the first render, so a save that spreads
  // `draft` and adds only one of the two silently clobbers the other. Routing all writes through
  // one helper keeps them from overwriting each other: a dropped key would mint a second key on
  // reload and record a duplicate inspection on retry, and dropped categories would lose the
  // Operator's confirmations if a submit failed and they came back.
  const persistDraft = useCallback(() => {
    if (!draft) return;
    save({
      ...draft,
      categories,
      submitIdempotencyKey: idempotencyKeyRef.current || draft.submitIdempotencyKey,
    });
  }, [draft, categories, save]);

  useEffect(() => {
    persistDraft();
  }, [persistDraft]);

  const notedFailures = useMemo(
    () =>
      draft
        ? failedItems
            .filter((item) => (draft.notes[item.itemKey]?.notes.trim().length ?? 0) > 0)
            .map((item) => ({ itemKey: item.itemKey, noteText: draft.notes[item.itemKey]!.notes }))
        : [],
    [draft, failedItems],
  );

  useDefectCategorySuggestions(
    notedFailures,
    // requested covers the abstain/UNAVAILABLE case, where suggested and confirmed are both left
    // undefined but the call already happened (see ItemCategory.requested).
    (itemKey) =>
      categories[itemKey]?.requested === true ||
      categories[itemKey]?.suggested !== undefined ||
      categories[itemKey]?.confirmed !== undefined,
    (itemKey, suggested) => {
      setCategories((prev) => ({
        ...prev,
        [itemKey]: { ...prev[itemKey], requested: true, suggested: suggested ?? undefined },
      }));
    },
  );

  const handleConfirmCategory = (itemKey: string, value: DefectCategory): void => {
    setCategories((prev) => ({ ...prev, [itemKey]: { ...prev[itemKey], confirmed: value } }));
  };

  const handleDismissCategory = (itemKey: string): void => {
    setCategories((prev) => ({ ...prev, [itemKey]: { ...prev[itemKey], confirmed: null } }));
  };

  // Same gate the checklist screen applies before handing off (lib/inspection-submit.ts, shared so
  // the two can't drift apart). Repeating it here closes the path where the operator reaches the
  // checklist from this screen, flips an item to fail, and returns with the browser's back
  // gesture, which remounts this screen against the updated draft.
  // Not memoized: the result is a boolean, and the effect dep below compares by value.
  const evidenceComplete = draft
    ? failuresDocumented(draft.items, draft.answers, draft.photoIds)
    : false;

  useEffect(() => {
    // No draft means a reload after the draft expired or was cleared, or the required evidence is
    // missing (the checklist screen applies the same gate before letting the operator submit).
    // Either way, send the operator back to the checklist rather than showing an empty or
    // unconfirmable attestation.
    if (!draft || !evidenceComplete) {
      router.replace(`/inspect/${params.equipmentId}`);
    }
  }, [draft, evidenceComplete, params.equipmentId, router]);

  if (!draft || !evidenceComplete) return <></>;

  const summary = attestationSummary(draft.items, draft.answers);
  const account = getActiveAccount(instance, accounts);
  const operator = account ? operatorDisplayName(account) : '';
  const isSubmitting = submitInspection.isPending;

  // The attestation itself. attested is true here and nowhere else in the app: it is the direct
  // consequence of this click, which the operator can only reach after seeing the summary above
  // (ADR 0007). buildSubmitPayload refuses to build a payload without it.
  const handleConfirm = async (): Promise<void> => {
    if (isSubmitting) return;
    setSubmitError(null);

    if (idempotencyKeyRef.current === '') {
      idempotencyKeyRef.current = crypto.randomUUID();
      // Persist through the shared helper so the just-minted key is stored alongside the live
      // categories, not on top of a stale draft that would drop one of the two.
      persistDraft();
    }

    try {
      const payload = buildSubmitPayload({
        equipmentId: draft.equipmentId,
        templateId: draft.templateId,
        items: draft.items,
        answers: draft.answers,
        notes: draft.notes,
        photoIds: draft.photoIds,
        categories,
        attested: true,
      });

      const inspection = await submitInspection.mutateAsync({
        payload,
        idempotencyKey: idempotencyKeyRef.current,
      });

      setResult({
        equipmentId: draft.equipmentId,
        inspectionId: inspection.id,
        result: inspection.result,
        failures: failedItems.map((item) => ({
          prompt: item.prompt,
          notes: draft.notes[item.itemKey]?.notes ?? '',
          photoId: draft.photoIds[item.itemKey]?.[0] ?? null,
        })),
      });

      // The record is on the server; the draft has served its purpose. Clearing it stops the next
      // inspection of this machine from reopening the answers that were just submitted.
      clear();

      // FAIL_BLOCKING is the server's derived result (ADR 0006), not a client guess from
      // failSeverity, so it is the only thing this branch trusts. It routes to the lockout tag
      // screen (DEV-22) instead of the generic fail confirmation, carrying the blocking defects
      // and the server's submittedAt since there is no endpoint to fetch them after the fact.
      if (inspection.result === 'FAIL_BLOCKING') {
        const lockoutParams = new URLSearchParams();
        for (const item of failedItems) {
          const notes = draft.notes[item.itemKey]?.notes.trim();
          lockoutParams.append('defect', notes ? `${item.prompt}: ${notes}` : item.prompt);
        }
        lockoutParams.set('lockedAt', inspection.submittedAt);
        router.push(`/lockout/${params.equipmentId}?${lockoutParams.toString()}`);
      } else {
        router.push(
          failedItems.length > 0
            ? `/checklist/${params.equipmentId}/submitted/fail`
            : `/checklist/${params.equipmentId}/submitted`,
        );
      }
    } catch (err) {
      setSubmitError(submitErrorMessage(err));
    }
  };

  return (
    <main className="min-h-screen bg-muted pb-28">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-sm font-extrabold uppercase tracking-wide">Review and Confirm</span>
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <div
          role="status"
          aria-label="Attestation summary"
          className="rounded-lg bg-card p-4 shadow-card"
        >
          <p className="text-base font-bold text-foreground">
            You answered {summary.answered} of {summary.total} items.
          </p>
          <p className="text-base font-bold text-foreground">{summary.failed} failed.</p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            Submitting as {operator}.
          </p>
        </div>

        {failedItems.length > 0 && (
          <div className="rounded-lg bg-card p-4 shadow-card">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Failed items
            </p>
            <ul aria-label="Failed items" className="mt-3 flex flex-col gap-3">
              {failedItems.map((item) => {
                const note = draft.notes[item.itemKey];
                const photos = draft.photoIds[item.itemKey]?.length ?? 0;
                return (
                  <li
                    key={item.itemKey}
                    className="border-l-4 border-warning pl-3 text-sm text-foreground"
                  >
                    <p className="font-bold">{item.prompt}</p>
                    {note?.notes.trim() && (
                      <>
                        <p className="mt-1 italic text-muted-foreground">{note.notes}</p>
                        <div className="mt-2">
                          <DefectCategoryPicker
                            category={categories[item.itemKey] ?? {}}
                            onConfirm={(value) => handleConfirmCategory(item.itemKey, value)}
                            onDismiss={() => handleDismissCategory(item.itemKey)}
                          />
                        </div>
                      </>
                    )}
                    {photos > 0 && (
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        {photos} evidence photo{photos === 1 ? '' : 's'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {submitError && (
          <p role="status" className="text-center text-xs font-semibold text-destructive">
            {submitError}
          </p>
        )}

        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleConfirm}
          className={`rounded-lg py-4 text-base font-bold shadow-card ${
            isSubmitting
              ? 'cursor-not-allowed bg-muted-foreground text-background'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          {isSubmitting ? 'Submitting...' : 'Confirm and Submit'}
        </button>

        <button
          type="button"
          onClick={() => router.push(`/inspect/${params.equipmentId}`)}
          className="rounded-lg border border-border bg-card py-3 text-sm font-semibold text-muted-foreground shadow-card"
        >
          Back to Checklist
        </button>
      </div>
    </main>
  );
}

export default function ReviewPage(): ReactElement {
  return (
    <AuthGuard>
      <ReviewView />
    </AuthGuard>
  );
}

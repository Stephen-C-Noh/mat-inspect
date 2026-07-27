'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '@/hooks/use-equipment';
import { useActiveChecklist } from '@/hooks/use-active-checklist';
import { useSubmitInspection } from '@/hooks/use-submit-inspection';
import { useInspectionDraftStore } from '@/hooks/use-inspection-draft-store';
import { useInspectionDraft } from '@/components/inspection-draft-provider';
import { submitErrorMessage } from '@/lib/submit-error-message';
import { ChecklistItemCard } from '@/components/checklist/checklist-item-card';
import { InspectionProgressCard } from '@/components/checklist/inspection-progress-card';
import { buildSubmitPayload } from '@/lib/inspection-submit';
import {
  answeredCount,
  failedCount,
  requiredItemsAnswered,
  type ChecklistAnswer,
} from '@/lib/checklist-answers';

function ChecklistView(): ReactElement {
  const params = useParams<{ equipmentId: string }>();
  const router = useRouter();

  const {
    data: equipmentList,
    isLoading: equipmentLoading,
    error: equipmentError,
  } = useEquipmentList();

  const equipment = useMemo(
    () => equipmentList?.find((candidate) => candidate.id === params.equipmentId),
    [equipmentList, params.equipmentId],
  );

  const {
    data: template,
    isLoading: checklistLoading,
    error: checklistError,
  } = useActiveChecklist(equipment?.type);

  // Seeded from the persisted draft, so a page load part-way through a walkaround returns the
  // operator to their answers instead of a blank checklist (DEV-125).
  const { restored, save, clear } = useInspectionDraftStore(params.equipmentId);
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>(
    () => restored?.answers ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>(() => restored?.inlineNotes ?? {});

  const { setResult } = useInspectionDraft();
  const submitInspection = useSubmitInspection();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One idempotency key per mounted checklist screen, so an operator retrying a failed pass-path
  // submit replays the original 201 instead of creating a second inspection (ADR 0009).
  const idempotencyKeyRef = useRef<string>('');

  // Persist on every answer, not only on the way to the failure screen. The reported defect lost
  // inspections that had never reached a failure screen at all, because nothing was stored until
  // then. Waits for the template, so a draft is never written without the items it answers.
  useEffect(() => {
    if (!template || !equipment) return;
    save({
      equipmentId: equipment.id,
      templateId: template.id,
      items: template.items,
      answers,
      inlineNotes: notes,
      // Owned by the failure screen. Preserved here so saving an answer does not wipe defect
      // notes the operator already recorded on a failure they then came back to change.
      failureDocs: restored?.failureDocs ?? {},
    });
  }, [answers, notes, template, equipment, save, restored]);

  if (equipmentLoading) return <div className="p-8 text-center">Loading equipment...</div>;
  if (equipmentError)
    return <div className="p-8 text-center text-destructive">Error loading equipment.</div>;
  if (!equipment)
    return <div className="p-8 text-center text-destructive">Equipment not found.</div>;

  if (checklistLoading) return <div className="p-8 text-center">Loading checklist...</div>;
  if (checklistError)
    return (
      <div className="p-8 text-center text-destructive">
        No active checklist for this equipment type.
      </div>
    );
  if (!template) return <></>;

  const canSubmit = requiredItemsAnswered(template.items, answers);
  const answered = answeredCount(template.items, answers);
  const failures = failedCount(template.items, answers);

  // With failures the action moves the operator to failure documentation (design 04), so the
  // label and color change to signal that, per design 03. On the clean path the button submits
  // the inspection directly (DEV-123).
  const submitLabel =
    failures > 0
      ? `Proceed with (${failures}) Failure${failures === 1 ? '' : 's'}`
      : 'Submit Inspection';
  const submitColor = failures > 0 ? 'bg-warning' : 'bg-primary';

  const isSubmitting = submitInspection.isPending;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || isSubmitting) return;
    setSubmitError(null);

    // Any failure sends the operator to document each defect first; the POST happens from that
    // screen once photos and notes are attached. The answers are already in the persisted draft,
    // which is what that screen reads.
    if (failures > 0) {
      save({
        equipmentId: equipment.id,
        templateId: template.id,
        items: template.items,
        answers,
        inlineNotes: notes,
        failureDocs: restored?.failureDocs ?? {},
      });
      router.push(`/checklist/${params.equipmentId}/failures`);
      return;
    }

    // Clean path: submit the attested answers now.
    if (idempotencyKeyRef.current === '') {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    try {
      const payload = buildSubmitPayload({
        equipmentId: equipment.id,
        templateId: template.id,
        items: template.items,
        answers,
        inlineNotes: notes,
      });
      const inspection = await submitInspection.mutateAsync({
        payload,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setResult({
        equipmentId: equipment.id,
        inspectionId: inspection.id,
        result: inspection.result,
        failures: [],
      });
      // The record is on the server; the draft has served its purpose. Clearing it stops the next
      // inspection of this machine from reopening the answers that were just submitted.
      clear();
      router.push(`/checklist/${params.equipmentId}/submitted`);
    } catch (err) {
      setSubmitError(submitErrorMessage(err));
    }
  };

  return (
    <main className="min-h-screen bg-muted pb-28">
      <header className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-sm font-extrabold uppercase tracking-wide">SAIT MAT School</span>
        <span className="text-xs font-semibold opacity-80">{equipment.assetTag}</span>
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-extrabold text-foreground">{equipment.name} Inspection</h1>
            <span className="rounded-lg bg-success px-3 py-1 text-xs font-bold text-success-foreground">
              {template.isActive ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Safety Compliance Log
          </p>
        </div>

        <InspectionProgressCard answered={answered} total={template.items.length} />

        {template.items.map((item) => (
          <ChecklistItemCard
            key={item.key}
            item={item}
            answer={answers[item.key]}
            notes={notes[item.key] ?? ''}
            onAnswerChange={(answer) => setAnswers((prev) => ({ ...prev, [item.key]: answer }))}
            onNotesChange={(value) => setNotes((prev) => ({ ...prev, [item.key]: value }))}
          />
        ))}

        {submitError && (
          <p
            role="status"
            className="fixed inset-x-4 bottom-20 mx-auto max-w-xl text-center text-xs font-semibold text-destructive"
          >
            {submitError}
          </p>
        )}

        <button
          type="button"
          disabled={!canSubmit || isSubmitting}
          title={canSubmit ? undefined : 'Answer all required items to submit'}
          onClick={handleSubmit}
          className={`fixed inset-x-4 bottom-4 mx-auto max-w-xl rounded-lg py-4 text-base font-bold shadow-card ${
            canSubmit && !isSubmitting
              ? `${submitColor} text-primary-foreground`
              : 'cursor-not-allowed bg-muted-foreground text-background'
          }`}
        >
          {isSubmitting ? 'Submitting...' : submitLabel}
        </button>
      </div>
    </main>
  );
}

export default function ChecklistPage(): ReactElement {
  return (
    <AuthGuard>
      <ChecklistView />
    </AuthGuard>
  );
}

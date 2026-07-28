'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '@/hooks/use-equipment';
import { useActiveChecklist } from '@/hooks/use-active-checklist';
import { useInspectionDraftStore } from '@/hooks/use-inspection-draft-store';
import { ChecklistItemCard } from '@/components/checklist/checklist-item-card';
import { InspectionProgressCard } from '@/components/checklist/inspection-progress-card';
import {
  answeredCount,
  failedCount,
  requiredItemsAnswered,
  type ChecklistAnswer,
} from '@/lib/checklist-answers';
import { failuresDocumented } from '@/lib/inspection-submit';
import { applyTextEdit, applyTranscript, emptyItemNote, type ItemNote } from '@/lib/voice-notes';

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
  const { restored, save } = useInspectionDraftStore(params.equipmentId);
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>(
    () => restored?.answers ?? {},
  );
  const [notes, setNotes] = useState<Record<string, ItemNote>>(() => restored?.notes ?? {});
  const [photoIds, setPhotoIds] = useState<Record<string, string[]>>(
    () => restored?.photoIds ?? {},
  );

  // Persist on every answer, not only on the way to review. The reported defect lost inspections
  // that had never reached a failure screen at all, because nothing was stored until then. Waits
  // for the template, so a draft is never written without the items it answers.
  //
  // submitIdempotencyKey is carried through rather than rebuilt. The review screen mints it on the
  // first confirm (ADR 0009) and this screen must not drop it: an operator who backs out to the
  // checklist after a POST timed out would otherwise return to review with no key, mint a second
  // one, and record a duplicate inspection instead of replaying the original 201.
  useEffect(() => {
    if (!template || !equipment) return;
    save({
      equipmentId: equipment.id,
      templateId: template.id,
      items: template.items,
      answers,
      notes,
      photoIds,
      ...(restored?.submitIdempotencyKey
        ? { submitIdempotencyKey: restored.submitIdempotencyKey }
        : {}),
    });
  }, [answers, notes, photoIds, template, equipment, save, restored]);

  // A note or evidence photo captured while an item read one way must not silently ride along
  // once the operator re-inspects it and the pass/fail value changes: sending it would misattribute
  // a defect (or drop one) on an immutable row (ADR 0008). Resetting here, rather than filtering at
  // submit time, means there is only ever one true state to reason about: whatever is in the box
  // was written against the answer currently showing.
  //
  // The previous answer is read from the current render rather than from inside a setAnswers
  // updater: an updater has to be a pure function of its argument, and React invokes it twice in
  // development, which would fire the two resets below twice as well.
  const handleAnswerChange = (itemKey: string, next: ChecklistAnswer): void => {
    const previous = answers[itemKey];
    if (
      previous?.kind === 'BOOLEAN' &&
      next.kind === 'BOOLEAN' &&
      previous.passed !== next.passed
    ) {
      // Only write a reset where there is something to reset. Writing unconditionally left an empty
      // note object behind for every item the operator ever toggled, and the draft is re-serialized
      // in full on every later change, so that padding rode along on all of them.
      if (notes[itemKey]) setNotes((prev) => ({ ...prev, [itemKey]: emptyItemNote() }));
      if (photoIds[itemKey]?.length) setPhotoIds((prev) => ({ ...prev, [itemKey]: [] }));
    }
    setAnswers((prev) => ({ ...prev, [itemKey]: next }));
  };

  const handleNotesChange = (itemKey: string, text: string): void => {
    setNotes((prev) => ({
      ...prev,
      [itemKey]: applyTextEdit(prev[itemKey] ?? emptyItemNote(), text),
    }));
  };

  // A voice transcript merges into whatever is already in the note (applyTranscript), rather than
  // replacing it: the operator may have typed part of the note, or recorded a second clip, before
  // this one lands.
  const handleTranscript = (itemKey: string, transcript: string): void => {
    setNotes((prev) => ({
      ...prev,
      [itemKey]: applyTranscript(prev[itemKey] ?? emptyItemNote(), transcript),
    }));
  };

  const handlePhotoIdsChange = (itemKey: string, ids: string[]): void => {
    setPhotoIds((prev) => ({ ...prev, [itemKey]: ids }));
  };

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

  // A photo-required failure (DEV-120) blocks submit the same way an unanswered required item
  // does, closing the gap the review screen's own copy of this gate exists to catch as a
  // safety net (see review/page.tsx), not as the primary place this is enforced.
  const canSubmit =
    requiredItemsAnswered(template.items, answers) &&
    failuresDocumented(template.items, answers, photoIds);
  const answered = answeredCount(template.items, answers);
  const failures = failedCount(template.items, answers);

  // The warning color signals there are failures to review, per design 03 (DEV-134 folded failure
  // documentation into this screen, so there is no longer a separate hand-off label for it).
  const submitLabel =
    failures > 0 ? `Review (${failures}) Failure${failures === 1 ? '' : 's'}` : 'Submit Inspection';
  const submitColor = failures > 0 ? 'bg-warning' : 'bg-primary';

  // This screen records nothing. The attestation is an explicit confirm taken on the review
  // screen after the operator sees a summary of their answers (ADR 0007), so submitting here only
  // hands off to review, which reads the same draft. There is no save here: the effect above has
  // already persisted every answer, note and photo by the time this button is reachable.
  const handleSubmit = (): void => {
    if (!canSubmit) return;
    router.push(`/checklist/${params.equipmentId}/review`);
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
            notes={notes[item.key]?.notes ?? ''}
            photoIds={photoIds[item.key] ?? []}
            onAnswerChange={(answer) => handleAnswerChange(item.key, answer)}
            onNotesChange={(value) => handleNotesChange(item.key, value)}
            onPhotoIdsChange={(ids) => handlePhotoIdsChange(item.key, ids)}
            onTranscript={(transcript) => handleTranscript(item.key, transcript)}
          />
        ))}

        <button
          type="button"
          disabled={!canSubmit}
          title={
            canSubmit
              ? undefined
              : 'Answer all required items and attach a photo to every photo-required failure to submit'
          }
          onClick={handleSubmit}
          className={`fixed inset-x-4 bottom-4 mx-auto max-w-xl rounded-lg py-4 text-base font-bold shadow-card ${
            canSubmit
              ? `${submitColor} text-primary-foreground`
              : 'cursor-not-allowed bg-muted-foreground text-background'
          }`}
        >
          {submitLabel}
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

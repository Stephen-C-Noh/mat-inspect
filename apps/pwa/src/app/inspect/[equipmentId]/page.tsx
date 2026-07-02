'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState, type ReactElement } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '@/hooks/use-equipment';
import { useActiveChecklist } from '@/hooks/use-active-checklist';
import { ChecklistItemCard } from '@/components/checklist/checklist-item-card';
import { InspectionProgressCard } from '@/components/checklist/inspection-progress-card';
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

  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

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

  // The submit control state is wired here (DEV-16); the actual POST is Sprint 2. With
  // failures the action moves the operator to failure documentation (design 04), so the
  // label and color change to signal that, per design 03.
  const submitLabel =
    failures > 0
      ? `Proceed with (${failures}) Failure${failures === 1 ? '' : 's'}`
      : 'Submit Inspection';
  const submitColor = failures > 0 ? 'bg-warning' : 'bg-primary';

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

        <button
          type="button"
          disabled={!canSubmit}
          title={canSubmit ? undefined : 'Answer all required items to submit'}
          onClick={() => {
            if (!canSubmit) return;
            if (failures > 0) {
              router.push(`/checklist/${params.equipmentId}/failures`);
            } else {
              router.push(`/checklist/${params.equipmentId}/submitted`);
            }
          }}
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

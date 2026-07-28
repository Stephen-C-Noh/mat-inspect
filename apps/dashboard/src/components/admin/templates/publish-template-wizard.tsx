'use client';

import { useState, type ReactElement } from 'react';
import type { EquipmentType } from '@mat-inspect/shared-types';
import {
  checklistItemSchema,
  type ChecklistItem,
  type ChecklistTemplate,
} from '@mat-inspect/shared-schemas';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { diffChecklistItems } from '@/lib/checklist-diff';
import { usePublishChecklistTemplate } from '@/hooks/use-publish-checklist-template';
import { ChecklistItemFormBuilder } from './checklist-item-form-builder';
import { ChecklistItemDiffView } from './checklist-item-diff-view';

type Props = {
  equipmentType: EquipmentType;
  currentActive: ChecklistTemplate | null;
  onClose: () => void;
};

const BLANK_ITEM: ChecklistItem = {
  key: '',
  prompt: '',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

type WizardState =
  | { step: 'editing'; items: ChecklistItem[] }
  | { step: 'previewing-diff'; items: ChecklistItem[]; diff: ReturnType<typeof diffChecklistItems> }
  | { step: 'submitting'; items: ChecklistItem[] }
  | { step: 'submitted'; template: ChecklistTemplate }
  | { step: 'error'; items: ChecklistItem[]; message: string };

export const PublishTemplateWizard = ({
  equipmentType,
  currentActive,
  onClose,
}: Props): ReactElement => {
  const [state, setState] = useState<WizardState>({
    step: 'editing',
    items: currentActive?.items ?? [{ ...BLANK_ITEM }],
  });
  const publish = usePublishChecklistTemplate();

  const canReview =
    state.step === 'editing' && checklistItemSchema.array().min(1).safeParse(state.items).success;

  const handleReviewChanges = (): void => {
    if (state.step !== 'editing') return;
    const diff = diffChecklistItems(currentActive?.items ?? [], state.items);
    setState({ step: 'previewing-diff', items: state.items, diff });
  };

  const handleBackToEdit = (): void => {
    if (state.step === 'previewing-diff' || state.step === 'error') {
      setState({ step: 'editing', items: state.items });
    }
  };

  const handleConfirmPublish = (): void => {
    if (state.step !== 'previewing-diff') return;
    const pendingItems = state.items;
    setState({ step: 'submitting', items: pendingItems });

    publish.mutate(
      { equipmentType, items: pendingItems },
      {
        onSuccess: (template) => setState({ step: 'submitted', template }),
        onError: (error) =>
          setState({ step: 'error', items: pendingItems, message: error.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish new checklist template — {equipmentType}</DialogTitle>
          <DialogDescription>
            {currentActive
              ? `Editing from active version ${currentActive.version}. Publishing creates version ${currentActive.version + 1} and retires the current one.`
              : 'No active template exists yet for this equipment type. This will become version 1.'}
          </DialogDescription>
        </DialogHeader>

        {state.step === 'editing' && (
          <ChecklistItemFormBuilder
            items={state.items}
            onChange={(next) => setState({ step: 'editing', items: next })}
          />
        )}

        {state.step === 'previewing-diff' && <ChecklistItemDiffView diff={state.diff} />}

        {(state.step === 'submitting' || state.step === 'submitted') && (
          <p className="text-sm text-muted-foreground">
            {state.step === 'submitting' ? 'Publishing…' : 'Published successfully.'}
          </p>
        )}

        {state.step === 'error' && (
          <p className="text-sm text-destructive">Failed to publish: {state.message}</p>
        )}

        <DialogFooter>
          {state.step === 'editing' && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handleReviewChanges} disabled={!canReview}>
                Review changes
              </Button>
            </>
          )}

          {state.step === 'previewing-diff' && (
            <>
              <Button type="button" variant="outline" onClick={handleBackToEdit}>
                Back to edit
              </Button>
              <Button type="button" onClick={handleConfirmPublish}>
                Confirm publish
              </Button>
            </>
          )}

          {state.step === 'submitting' && (
            <Button type="button" disabled>
              Publishing…
            </Button>
          )}

          {state.step === 'submitted' && (
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          )}

          {state.step === 'error' && (
            <>
              <Button type="button" variant="outline" onClick={handleBackToEdit}>
                Back to edit
              </Button>
              <Button type="button" onClick={handleConfirmPublish}>
                Try again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

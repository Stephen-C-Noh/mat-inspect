import { useState, type ReactElement } from 'react';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ChecklistAnswer } from '@/lib/checklist-answers';
import { isItemAnswered } from '@/lib/checklist-answers';
import { SeverityTag } from './severity-tag';
import { RegulatoryInfo } from './regulatory-info';
import { BooleanToggle } from './boolean-toggle';
import { TextResponseInput } from './text-response-input';
import { PhotoRequiredPrompt } from './photo-required-prompt';

type Props = {
  item: ChecklistItem;
  answer: ChecklistAnswer | undefined;
  notes: string;
  onAnswerChange: (answer: ChecklistAnswer) => void;
  onNotesChange: (notes: string) => void;
};

// BOOLEAN and BOOLEAN_PHOTO_ON_FAIL render the same pass/fail toggle; the photo prompt is
// the only difference, and only on a fail. There is no SIGNATURE or MEASUREMENT control.
const isBooleanType = (item: ChecklistItem): boolean =>
  item.type === 'BOOLEAN' || item.type === 'BOOLEAN_PHOTO_ON_FAIL';

const borderColorFor = (item: ChecklistItem, answer: ChecklistAnswer | undefined): string => {
  if (!isItemAnswered(item, answer)) return 'border-l-border';
  if (answer?.kind === 'BOOLEAN')
    return answer.passed ? 'border-l-success' : 'border-l-destructive';
  return 'border-l-success';
};

export const ChecklistItemCard = ({
  item,
  answer,
  notes,
  onAnswerChange,
  onNotesChange,
}: Props): ReactElement => {
  const failed = answer?.kind === 'BOOLEAN' && !answer.passed;
  const passed = answer?.kind === 'BOOLEAN' && answer.passed;

  // A passing answer needs no further input, so collapse it to a summary row to keep the
  // list scannable (design 03). A failing answer stays expanded so the operator can
  // document the defect in notes.
  const [collapsed, setCollapsed] = useState(false);

  const handleBooleanChange = (nextPassed: boolean): void => {
    onAnswerChange({ kind: 'BOOLEAN', passed: nextPassed });
    setCollapsed(nextPassed);
  };

  if (isBooleanType(item) && passed && collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center justify-between rounded-sm border-l-4 border-l-success bg-card p-4 text-left shadow-card"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Status
            </span>
            <span className="rounded-lg bg-success px-3 py-1 text-xs font-bold text-success-foreground">
              Pass
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-foreground">{item.prompt}</p>
        </div>
        <span aria-hidden className="text-muted-foreground">
          ⌄
        </span>
      </button>
    );
  }

  return (
    <div
      className={`rounded-sm border-l-4 bg-card p-4 shadow-card ${borderColorFor(item, answer)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-foreground">
          {item.prompt}
          {item.required && (
            <span className="ml-1 text-destructive" aria-label="Required">
              *
            </span>
          )}
        </h3>
        {item.regulatoryReference && <RegulatoryInfo reference={item.regulatoryReference} />}
      </div>

      <div className="mt-2">
        <SeverityTag severity={item.failSeverity} />
      </div>

      <div className="mt-4">
        {isBooleanType(item) && (
          <>
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Status
            </span>
            <div className="mt-1">
              <BooleanToggle
                passed={answer?.kind === 'BOOLEAN' ? answer.passed : undefined}
                onChange={handleBooleanChange}
              />
            </div>
          </>
        )}

        {item.type === 'TEXT' && (
          <TextResponseInput
            value={answer?.kind === 'TEXT' ? answer.value : undefined}
            onChange={(value) => onAnswerChange({ kind: 'TEXT', value })}
          />
        )}
      </div>

      {item.type === 'BOOLEAN_PHOTO_ON_FAIL' && failed && (
        <div className="mt-3">
          <PhotoRequiredPrompt />
        </div>
      )}

      {item.type !== 'TEXT' && (
        <div className="mt-4">
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Add any observations or comments..."
            rows={2}
            className="mt-1 w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          />
        </div>
      )}

      <button
        type="button"
        disabled
        title="Voice notes are coming in a later sprint"
        className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-muted py-3 text-sm font-bold text-muted-foreground"
      >
        <span aria-hidden>🎤</span>
        Add Voice Note
      </button>
    </div>
  );
};

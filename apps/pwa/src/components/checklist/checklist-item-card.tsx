import { useState, type ReactElement } from 'react';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ChecklistAnswer } from '@/lib/checklist-answers';
import { isItemAnswered } from '@/lib/checklist-answers';
import { SeverityTag } from './severity-tag';
import { RegulatoryInfo } from './regulatory-info';
import { BooleanToggle } from './boolean-toggle';
import { MeasurementInput } from './measurement-input';
import { TextResponseInput } from './text-response-input';
import { SignaturePad } from './signature-pad';
import { PhotoRequiredPrompt } from './photo-required-prompt';

type Props = {
  item: ChecklistItem;
  answer: ChecklistAnswer | undefined;
  notes: string;
  onAnswerChange: (answer: ChecklistAnswer) => void;
  onNotesChange: (notes: string) => void;
};

const borderColorFor = (item: ChecklistItem, answer: ChecklistAnswer | undefined): string => {
  if (!isItemAnswered(item, answer)) return 'border-l-slate-300';
  if (answer?.kind === 'BOOLEAN') return answer.passed ? 'border-l-green-500' : 'border-l-red-500';
  return 'border-l-green-500';
};

const isBooleanType = (item: ChecklistItem): boolean =>
  item.type === 'BOOLEAN' || item.type === 'BOOLEAN_PHOTO_ON_FAIL';

export const ChecklistItemCard = ({
  item,
  answer,
  notes,
  onAnswerChange,
  onNotesChange,
}: Props): ReactElement => {
  const failed = answer?.kind === 'BOOLEAN' && !answer.passed;
  const passed = answer?.kind === 'BOOLEAN' && answer.passed;

  // A passing answer needs no further input, so collapse it to a summary row to
  // keep the list scannable. A failing answer always stays expanded: it requires
  // notes to document the defect, per Section 10.1.
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
        className="flex w-full items-center justify-between rounded-2xl border-l-4 border-l-green-500 bg-white p-4 text-left shadow-sm"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Status</span>
            <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">
              Pass
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-slate-700">{item.prompt}</p>
        </div>
        <span aria-hidden className="text-slate-400">
          ⌄
        </span>
      </button>
    );
  }

  return (
    <div
      className={`rounded-2xl border-l-4 bg-white p-4 shadow-sm ${borderColorFor(item, answer)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">
          {item.prompt}
          {item.required && (
            <span className="ml-1 text-red-600" aria-label="Required">
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
          <BooleanToggle
            passed={answer?.kind === 'BOOLEAN' ? answer.passed : undefined}
            onChange={handleBooleanChange}
          />
        )}

        {item.type === 'MEASUREMENT' && (
          <MeasurementInput
            value={answer?.kind === 'MEASUREMENT' ? answer.value : undefined}
            onChange={(value) => onAnswerChange({ kind: 'MEASUREMENT', value })}
          />
        )}

        {item.type === 'TEXT' && (
          <TextResponseInput
            value={answer?.kind === 'TEXT' ? answer.value : undefined}
            onChange={(value) => onAnswerChange({ kind: 'TEXT', value })}
          />
        )}

        {item.type === 'SIGNATURE' && (
          <SignaturePad
            signed={answer?.kind === 'SIGNATURE' && answer.signed}
            onChange={(signed) => onAnswerChange({ kind: 'SIGNATURE', signed })}
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
          <label className="text-xs font-bold uppercase tracking-wide text-slate-400">Notes</label>
          <textarea
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Add any observations or comments..."
            rows={2}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}

      <button
        type="button"
        disabled
        title="Voice notes are coming in a later sprint"
        className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-200 py-3 text-sm font-bold text-slate-400"
      >
        <span aria-hidden>🎤</span>
        Add Voice Note
      </button>
    </div>
  );
};

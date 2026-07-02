import { useState, type ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
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

const statusLabel = (answer: ChecklistAnswer | undefined): ReactElement | null => {
  if (!answer) return null;
  if (answer.kind === 'BOOLEAN')
    return answer.passed ? (
      <span className="rounded-sm bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
        Pass
      </span>
    ) : (
      <span className="rounded-sm bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
        Fail
      </span>
    );
  return (
    <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
      Answered
    </span>
  );
};

export const ChecklistItemCard = ({
  item,
  answer,
  notes,
  onAnswerChange,
  onNotesChange,
}: Props): ReactElement => {
  const failed = answer?.kind === 'BOOLEAN' && !answer.passed;

  // Passing auto-collapses so the list stays scannable (design 03). Any item can also be
  // manually collapsed/expanded via the chevron in the header.
  const [collapsed, setCollapsed] = useState(false);

  const handleBooleanChange = (nextPassed: boolean): void => {
    onAnswerChange({ kind: 'BOOLEAN', passed: nextPassed });
    setCollapsed(nextPassed);
  };

  return (
    <div className={`rounded-sm border-l-4 bg-card shadow-card ${borderColorFor(item, answer)}`}>
      {/* Header — always visible, tapping toggles the body */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-start justify-between gap-2 p-4 text-left"
      >
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground">
            {item.prompt}
            {item.required && (
              <span className="ml-1 text-destructive" aria-label="Required">
                *
              </span>
            )}
          </h3>
          {collapsed && <div className="mt-1">{statusLabel(answer)}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {item.regulatoryReference && !collapsed && (
            <RegulatoryInfo reference={item.regulatoryReference} />
          )}
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform duration-200 ${
              collapsed ? '' : 'rotate-180'
            }`}
          />
        </div>
      </button>

      {/* Body — hidden when collapsed */}
      {!collapsed && (
        <div className="px-4 pb-4">
          <div className="mb-4">
            <SeverityTag severity={item.failSeverity} />
          </div>

          <div>
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
                className="mt-1 w-full rounded-sm border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
              />
            </div>
          )}

          <button
            type="button"
            disabled
            title="Voice notes are coming in a later sprint"
            className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-sm bg-muted py-3 text-sm font-bold text-muted-foreground"
          >
            <span aria-hidden>🎤</span>
            Add Voice Note
          </button>
        </div>
      )}
    </div>
  );
};

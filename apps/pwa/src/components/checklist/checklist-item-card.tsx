import { useState, type ReactElement } from 'react';
import { ChevronDown, Mic } from 'lucide-react';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ChecklistAnswer } from '@/lib/checklist-answers';
import { isItemAnswered } from '@/lib/checklist-answers';
import { useVoiceNoteRecorder } from '@/hooks/use-voice-note-recorder';
import { formatElapsed, MAX_RECORDING_MS } from '@/lib/voice-notes';
import { SeverityTag } from './severity-tag';
import { RegulatoryInfo } from './regulatory-info';
import { BooleanToggle } from './boolean-toggle';
import { TextResponseInput } from './text-response-input';
import { EvidencePhotoCapture } from './evidence-photo-capture';

type Props = {
  item: ChecklistItem;
  answer: ChecklistAnswer | undefined;
  notes: string;
  photoIds: string[];
  onAnswerChange: (answer: ChecklistAnswer) => void;
  onNotesChange: (notes: string) => void;
  onPhotoIdsChange: (photoIds: string[]) => void;
  onTranscript: (transcript: string) => void;
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
  photoIds,
  onAnswerChange,
  onNotesChange,
  onPhotoIdsChange,
  onTranscript,
}: Props): ReactElement => {
  const failed = answer?.kind === 'BOOLEAN' && !answer.passed;

  // Passing auto-collapses so the list stays scannable (design 03). Any item can also be
  // manually collapsed/expanded via the chevron in the header.
  const [collapsed, setCollapsed] = useState(false);

  // The transcript is handed straight up: merging it into the existing note text is a business rule
  // that lives in lib/voice-notes (applyTranscript), not in this component.
  const voiceRecorder = useVoiceNoteRecorder(onTranscript);

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
            <EvidencePhotoCapture photoIds={photoIds} onPhotoIdsChange={onPhotoIdsChange} />
          )}

          {/*
            "For each failed item, the app shows a notes field with two options: type or tap to
            dictate" (ARCHITECTURE.md 7.1). Both input methods sit together here, so dictation is
            available on every failed item rather than only the photo-required ones. The note itself
            stays optional (the schema has it as optional text); nothing here gates submit.
          */}
          {failed && (
            <div className="mt-4">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Describe the defect, or tap to dictate..."
                rows={2}
                className="mt-1 w-full rounded-sm border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
              />
              <button
                type="button"
                onClick={
                  voiceRecorder.state.status === 'recording'
                    ? voiceRecorder.stop
                    : voiceRecorder.start
                }
                disabled={voiceRecorder.state.status === 'transcribing'}
                className={`mt-2 flex w-full items-center justify-center gap-2 rounded-sm py-3 text-sm font-bold shadow-card transition-colors disabled:opacity-60 ${
                  voiceRecorder.state.status === 'recording'
                    ? 'animate-pulse bg-red-600 text-white hover:bg-red-700'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                <Mic className="size-4" />
                {voiceRecorder.state.status === 'recording'
                  ? `Stop Recording ${formatElapsed(voiceRecorder.state.elapsedMs)} / ${formatElapsed(MAX_RECORDING_MS)}`
                  : voiceRecorder.state.status === 'transcribing'
                    ? 'Transcribing...'
                    : 'Add Voice Note'}
              </button>
              {voiceRecorder.state.status === 'error' && (
                <p role="status" className="mt-2 text-xs font-semibold text-warning">
                  {voiceRecorder.state.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

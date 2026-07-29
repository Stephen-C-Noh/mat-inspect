import type { ReactElement } from 'react';
import { CheckCircle, MinusCircle, PlusCircle } from 'lucide-react';
import type { ChecklistItem, ChecklistTemplateItemChange } from '@mat-inspect/shared-schemas';
import type { ChecklistItemDiff } from '@/lib/checklist-diff';

type Props = { diff: ChecklistItemDiff };

const SectionHeading = ({
  icon: Icon,
  label,
  classes,
}: {
  icon: typeof PlusCircle;
  label: string;
  classes: string;
}): ReactElement => (
  <div
    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${classes}`}
  >
    <Icon className="size-3.5" aria-hidden />
    {label}
  </div>
);

const AddedRow = ({ item }: { item: ChecklistItem }): ReactElement => (
  <li className="rounded-sm border border-border bg-card p-2 text-sm">
    <span className="font-mono text-xs text-muted-foreground">{item.key}</span> — {item.prompt}
  </li>
);

const ChangedRow = ({ change }: { change: ChecklistTemplateItemChange }): ReactElement => {
  const fields = (Object.keys(change.after) as (keyof ChecklistItem)[]).filter(
    (field) => change.before[field] !== change.after[field],
  );

  return (
    <li className="rounded-sm border border-border bg-card p-2 text-sm">
      <span className="font-mono text-xs text-muted-foreground">{change.key}</span>
      <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-xs">
        {fields.map((field) => (
          <li key={field}>
            <span className="font-semibold">{field}</span>: {String(change.before[field])} →{' '}
            {String(change.after[field])}
          </li>
        ))}
      </ul>
    </li>
  );
};

// Renders an item-level diff (added/removed/changed, keyed by item.key). Shared by the
// mandatory local diff shown before a publish and, potentially later, a historical
// version-vs-version browse view — both produce the same shape (see ChecklistItemDiff).
export const ChecklistItemDiffView = ({ diff }: Props): ReactElement => {
  const { added, removed, changed } = diff;

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes from the active version.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {added.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading
            icon={PlusCircle}
            label={`ADDED (${added.length})`}
            classes="bg-success text-success-foreground"
          />
          <ul className="flex flex-col gap-1.5">
            {added.map((item) => (
              <AddedRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}

      {removed.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading
            icon={MinusCircle}
            label={`REMOVED (${removed.length})`}
            classes="bg-destructive text-destructive-foreground"
          />
          <ul className="flex flex-col gap-1.5">
            {removed.map((item) => (
              <AddedRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}

      {changed.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeading
            icon={CheckCircle}
            label={`CHANGED (${changed.length})`}
            classes="bg-warning text-warning-foreground"
          />
          <ul className="flex flex-col gap-1.5">
            {changed.map((change) => (
              <ChangedRow key={change.key} change={change} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

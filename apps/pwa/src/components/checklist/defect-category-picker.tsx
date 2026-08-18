'use client';

import { useState, type ReactElement } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { DefectCategory } from '@mat-inspect/shared-types';
import {
  DEFECT_CATEGORIES,
  DEFECT_CATEGORY_LABELS,
  type ItemCategory,
} from '@/lib/defect-category';

type Props = {
  category: ItemCategory;
  onConfirm: (category: DefectCategory) => void;
  onDismiss: () => void;
};

// Renders one FAIL item's defect-category state on the review screen (ADR 0028). Four states,
// none of them ever touching severity or pass/fail:
//
// - suggested, unconfirmed: an outlined chip (accent border, sparkle marker) the Operator taps
//   to confirm, or dismisses with the x.
// - confirmed: the only filled chip, plus a ghost "Change" button that reopens the full set.
// - dismissed: a muted "No category" label plus an "Add category" affordance.
// - nothing to show (not fetched yet, the model abstained, or it was unavailable): just "Add
//   category". The Operator can always categorize manually; the model's absence never blocks it.
export const DefectCategoryPicker = ({ category, onConfirm, onDismiss }: Props): ReactElement => {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className="flex flex-wrap gap-2">
        {DEFECT_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              onConfirm(value);
              setExpanded(false);
            }}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent hover:text-accent"
          >
            {DEFECT_CATEGORY_LABELS[value]}
          </button>
        ))}
      </div>
    );
  }

  if (category.confirmed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
          {DEFECT_CATEGORY_LABELS[category.confirmed]}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-accent hover:text-accent"
        >
          Change
        </button>
      </div>
    );
  }

  if (category.confirmed === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold italic text-muted-foreground">No category</span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-accent hover:text-accent"
        >
          Add category
        </button>
      </div>
    );
  }

  if (category.suggested) {
    const suggested = category.suggested;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onConfirm(suggested)}
          aria-label={`Confirm suggested category ${DEFECT_CATEGORY_LABELS[suggested]}`}
          className="flex items-center gap-1.5 rounded-full border-2 border-accent bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-accent/10"
        >
          <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
          {DEFECT_CATEGORY_LABELS[suggested]}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggested category"
          className="rounded-full border border-border bg-card p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-accent hover:text-accent"
    >
      Add category
    </button>
  );
};

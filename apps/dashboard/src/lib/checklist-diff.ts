import type { ChecklistItem, ChecklistTemplateItemChange } from '@mat-inspect/shared-schemas';

export type ChecklistItemDiff = {
  added: ChecklistItem[];
  removed: ChecklistItem[];
  changed: ChecklistTemplateItemChange[];
};

// Mirrors services/core-api/src/routes/checklists/diff-items.ts so the publish wizard's
// preview matches the server's own /checklists/:id/diff/:otherId semantics exactly. Can't
// call that endpoint directly here: the draft being reviewed has no id until POST succeeds,
// so the comparison has to run client-side against the current active template's items.
// Items are matched by key, not array position, so reordering items between versions does not
// read as a spurious add/remove/change (DEV-63).
export const diffChecklistItems = (
  fromItems: ChecklistItem[],
  toItems: ChecklistItem[],
): ChecklistItemDiff => {
  const from = new Map(fromItems.map((item) => [item.key, item]));
  const to = new Map(toItems.map((item) => [item.key, item]));

  const added = [...to.values()].filter((item) => !from.has(item.key));
  const removed = [...from.values()].filter((item) => !to.has(item.key));
  const changed: ChecklistTemplateItemChange[] = [...from.entries()].flatMap(([key, before]) => {
    const after = to.get(key);
    return after && JSON.stringify(before) !== JSON.stringify(after)
      ? [{ key, before, after }]
      : [];
  });

  return { added, removed, changed };
};

import type { ChecklistItem, ChecklistTemplateItemChange } from '@mat-inspect/shared-schemas';

export type ChecklistItemDiff = {
  added: ChecklistItem[];
  removed: ChecklistItem[];
  changed: ChecklistTemplateItemChange[];
};

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

import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { diffChecklistItems } from './checklist-diff';

const item = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
  key: 'hoist-brake',
  prompt: 'Hoist brake engages and holds load',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
  ...overrides,
});

describe('diffChecklistItems', () => {
  it('returns an empty diff for identical arrays', () => {
    const items = [item()];
    expect(diffChecklistItems(items, items)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('reports an item present only in "to" as added', () => {
    const from = [item({ key: 'a' })];
    const to = [item({ key: 'a' }), item({ key: 'b', prompt: 'New check' })];

    const diff = diffChecklistItems(from, to);

    expect(diff.added).toEqual([item({ key: 'b', prompt: 'New check' })]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('reports an item present only in "from" as removed', () => {
    const from = [item({ key: 'a' }), item({ key: 'b' })];
    const to = [item({ key: 'a' })];

    const diff = diffChecklistItems(from, to);

    expect(diff.removed).toEqual([item({ key: 'b' })]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('reports a shared key with a changed field as changed', () => {
    const from = [item({ key: 'a', failSeverity: 'WARNING' })];
    const to = [item({ key: 'a', failSeverity: 'BLOCKING' })];

    const diff = diffChecklistItems(from, to);

    expect(diff.changed).toEqual([{ key: 'a', before: from[0], after: to[0] }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('omits a shared key whose fields are all identical', () => {
    const from = [item({ key: 'a' }), item({ key: 'b' })];
    const to = [item({ key: 'b' }), item({ key: 'a' })];

    // Reordering alone (matched by key, not array position, per DEV-63) must not read as a change.
    expect(diffChecklistItems(from, to)).toEqual({ added: [], removed: [], changed: [] });
  });
});

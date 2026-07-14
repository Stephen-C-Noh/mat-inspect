import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { diffChecklistItems } from './diff-items.js';

const item = (overrides: Partial<ChecklistItem> & Pick<ChecklistItem, 'key'>): ChecklistItem => ({
  prompt: 'prompt',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
  ...overrides,
});

describe('diffChecklistItems', () => {
  it('returns empty added/removed/changed for identical item sets', () => {
    const items = [item({ key: 'horn' }), item({ key: 'forks-condition' })];

    expect(diffChecklistItems(items, items)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('reports a key present only in the target version as added', () => {
    const from = [item({ key: 'horn' })];
    const to = [item({ key: 'horn' }), item({ key: 'hydraulic-leaks' })];

    const result = diffChecklistItems(from, to);

    expect(result.added).toEqual([item({ key: 'hydraulic-leaks' })]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('reports a key present only in the source version as removed', () => {
    const from = [item({ key: 'horn' }), item({ key: 'hydraulic-leaks' })];
    const to = [item({ key: 'horn' })];

    const result = diffChecklistItems(from, to);

    expect(result.removed).toEqual([item({ key: 'hydraulic-leaks' })]);
    expect(result.added).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('reports a key present in both with different fields as changed, with before/after', () => {
    const from = [item({ key: 'horn', failSeverity: 'WARNING' })];
    const to = [item({ key: 'horn', failSeverity: 'BLOCKING' })];

    const result = diffChecklistItems(from, to);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([
      {
        key: 'horn',
        before: item({ key: 'horn', failSeverity: 'WARNING' }),
        after: item({ key: 'horn', failSeverity: 'BLOCKING' }),
      },
    ]);
  });

  it('does not report a key as changed when reordered but otherwise identical', () => {
    const from = [item({ key: 'horn' }), item({ key: 'forks-condition' })];
    const to = [item({ key: 'forks-condition' }), item({ key: 'horn' })];

    expect(diffChecklistItems(from, to)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('handles empty item lists on either side', () => {
    const items = [item({ key: 'horn' })];

    expect(diffChecklistItems([], items)).toEqual({ added: items, removed: [], changed: [] });
    expect(diffChecklistItems(items, [])).toEqual({ added: [], removed: items, changed: [] });
  });
});

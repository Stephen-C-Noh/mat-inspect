import { describe, it, expect } from 'vitest';
import type { ChecklistItemRecord } from '@mat-inspect/db';
import { collectBlockingDefectDescriptions } from './blocking-defects.js';

const items: ChecklistItemRecord[] = [
  {
    key: 'forks-condition',
    prompt: 'Forks free of cracks, bends, and excessive wear',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'mast-chains',
    prompt: 'Mast chains intact and properly tensioned',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'horn',
    prompt: 'Horn sounds when tested',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
];

describe('collectBlockingDefectDescriptions', () => {
  it('returns the prompts of the failed BLOCKING items', () => {
    const result = collectBlockingDefectDescriptions(items, [
      { itemKey: 'forks-condition', value: false, passed: false },
      { itemKey: 'mast-chains', value: false, passed: false },
      { itemKey: 'horn', value: true, passed: true },
    ]);
    expect(result).toEqual([
      'Forks free of cracks, bends, and excessive wear',
      'Mast chains intact and properly tensioned',
    ]);
  });

  it('ignores passing responses', () => {
    const result = collectBlockingDefectDescriptions(items, [
      { itemKey: 'forks-condition', value: true, passed: true },
    ]);
    expect(result).toEqual([]);
  });

  it('ignores a failed WARNING item (only BLOCKING failures are defects here)', () => {
    const result = collectBlockingDefectDescriptions(items, [
      { itemKey: 'horn', value: false, passed: false },
    ]);
    expect(result).toEqual([]);
  });

  it('returns an empty list when nothing failed', () => {
    expect(collectBlockingDefectDescriptions(items, [])).toEqual([]);
  });
});

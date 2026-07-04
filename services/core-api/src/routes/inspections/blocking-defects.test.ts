import { describe, it, expect } from 'vitest';
import type { ChecklistItemRecord } from '@mat-inspect/db';
import type { InspectionResponse } from '@mat-inspect/shared-schemas';
import {
  blockingFailures,
  buildBlockingDefect,
  collectBlockingDefectDescriptions,
} from './blocking-defects.js';

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

describe('blockingFailures', () => {
  it('returns only the failed BLOCKING items, in response order, with trimmed notes', () => {
    const result = blockingFailures(items, [
      { itemKey: 'forks-condition', value: false, passed: false, notes: '  cracked  ' },
      { itemKey: 'mast-chains', value: false, passed: false },
      { itemKey: 'horn', value: false, passed: false },
    ]);
    expect(result).toEqual([
      {
        itemKey: 'forks-condition',
        prompt: 'Forks free of cracks, bends, and excessive wear',
        note: 'cracked',
      },
      { itemKey: 'mast-chains', prompt: 'Mast chains intact and properly tensioned', note: null },
    ]);
  });

  it('treats a blank note as no note', () => {
    const [failure] = blockingFailures(items, [
      { itemKey: 'forks-condition', value: false, passed: false, notes: '   ' },
    ]);
    expect(failure?.note).toBeNull();
  });

  it('returns an empty list when nothing blocking failed', () => {
    expect(blockingFailures(items, [{ itemKey: 'horn', value: false, passed: false }])).toEqual([]);
  });
});

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

describe('buildBlockingDefect', () => {
  it('returns null when no response fails', () => {
    const responses: InspectionResponse[] = [
      { itemKey: 'forks-condition', value: true, passed: true },
      { itemKey: 'horn', value: true, passed: true },
    ];
    expect(buildBlockingDefect(items, responses)).toBeNull();
  });

  it('returns null when only a WARNING item fails', () => {
    const responses: InspectionResponse[] = [
      { itemKey: 'forks-condition', value: true, passed: true },
      { itemKey: 'horn', value: false, passed: false },
    ];
    expect(buildBlockingDefect(items, responses)).toBeNull();
  });

  it('opens one defect for a single blocking failure, using the item prompt', () => {
    const responses: InspectionResponse[] = [
      { itemKey: 'forks-condition', value: false, passed: false },
      { itemKey: 'horn', value: true, passed: true },
    ];
    const defect = buildBlockingDefect(items, responses);
    expect(defect).toEqual({
      itemKey: 'forks-condition',
      severity: 'BLOCKING',
      description: 'Forks free of cracks, bends, and excessive wear',
    });
  });

  it('appends the operator note to the prompt when present', () => {
    const responses: InspectionResponse[] = [
      { itemKey: 'forks-condition', value: false, passed: false, notes: 'Right tine cracked' },
    ];
    const defect = buildBlockingDefect(items, responses);
    expect(defect?.description).toBe(
      'Forks free of cracks, bends, and excessive wear: Right tine cracked',
    );
  });

  it('aggregates several blocking failures into one defect, keyed on the first', () => {
    const responses: InspectionResponse[] = [
      { itemKey: 'forks-condition', value: false, passed: false, notes: 'Cracked' },
      { itemKey: 'mast-chains', value: false, passed: false },
      { itemKey: 'horn', value: false, passed: false },
    ];
    const defect = buildBlockingDefect(items, responses);
    expect(defect?.itemKey).toBe('forks-condition');
    expect(defect?.description).toBe(
      'Forks free of cracks, bends, and excessive wear: Cracked; Mast chains intact and properly tensioned',
    );
  });

  it('ignores a blank note and falls back to the prompt', () => {
    const responses: InspectionResponse[] = [
      { itemKey: 'forks-condition', value: false, passed: false, notes: '   ' },
    ];
    expect(buildBlockingDefect(items, responses)?.description).toBe(
      'Forks free of cracks, bends, and excessive wear',
    );
  });
});

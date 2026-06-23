import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import { answeredCount, isItemAnswered, requiredItemsAnswered } from './checklist-answers';

const booleanItem: ChecklistItem = {
  key: 'cable',
  prompt: 'Cables intact?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

const measurementItem: ChecklistItem = {
  key: 'psi',
  prompt: 'Tire pressure',
  type: 'MEASUREMENT',
  required: true,
  failSeverity: 'WARNING',
};

const optionalTextItem: ChecklistItem = {
  key: 'notes',
  prompt: 'Additional notes',
  type: 'TEXT',
  required: false,
  failSeverity: 'WARNING',
};

describe('isItemAnswered', () => {
  it('is false with no answer', () => {
    expect(isItemAnswered(booleanItem, undefined)).toBe(false);
  });

  it('treats any explicit pass/fail as answered', () => {
    expect(isItemAnswered(booleanItem, { kind: 'BOOLEAN', passed: false })).toBe(true);
    expect(isItemAnswered(booleanItem, { kind: 'BOOLEAN', passed: true })).toBe(true);
  });

  it('requires a non-NaN measurement', () => {
    expect(isItemAnswered(measurementItem, { kind: 'MEASUREMENT', value: Number.NaN })).toBe(false);
    expect(isItemAnswered(measurementItem, { kind: 'MEASUREMENT', value: 32 })).toBe(true);
  });

  it('requires non-empty text', () => {
    expect(isItemAnswered(optionalTextItem, { kind: 'TEXT', value: '   ' })).toBe(false);
    expect(isItemAnswered(optionalTextItem, { kind: 'TEXT', value: 'ok' })).toBe(true);
  });

  it('requires a drawn signature, not just a present answer', () => {
    expect(isItemAnswered(booleanItem, { kind: 'SIGNATURE', signed: false })).toBe(false);
    expect(isItemAnswered(booleanItem, { kind: 'SIGNATURE', signed: true })).toBe(true);
  });
});

describe('requiredItemsAnswered', () => {
  it('blocks submit when a required item is unanswered', () => {
    expect(requiredItemsAnswered([booleanItem, measurementItem], {})).toBe(false);
  });

  it('ignores unanswered optional items', () => {
    const answers = {
      cable: { kind: 'BOOLEAN' as const, passed: true },
      psi: { kind: 'MEASUREMENT' as const, value: 32 },
    };
    expect(requiredItemsAnswered([booleanItem, measurementItem, optionalTextItem], answers)).toBe(
      true,
    );
  });
});

describe('answeredCount', () => {
  it('counts only answered items', () => {
    const answers = { cable: { kind: 'BOOLEAN' as const, passed: true } };
    expect(answeredCount([booleanItem, measurementItem], answers)).toBe(1);
  });
});

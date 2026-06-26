import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import {
  answeredCount,
  failedCount,
  isItemAnswered,
  requiredItemsAnswered,
} from './checklist-answers';

const booleanItem: ChecklistItem = {
  key: 'cable',
  prompt: 'Cables intact?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

const textItem: ChecklistItem = {
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

  it('requires non-empty text', () => {
    expect(isItemAnswered(textItem, { kind: 'TEXT', value: '   ' })).toBe(false);
    expect(isItemAnswered(textItem, { kind: 'TEXT', value: 'ok' })).toBe(true);
  });
});

describe('requiredItemsAnswered', () => {
  it('blocks submit when a required item is unanswered', () => {
    expect(requiredItemsAnswered([booleanItem, textItem], {})).toBe(false);
  });

  it('ignores unanswered optional items', () => {
    const answers = { cable: { kind: 'BOOLEAN' as const, passed: true } };
    expect(requiredItemsAnswered([booleanItem, textItem], answers)).toBe(true);
  });
});

describe('answeredCount', () => {
  it('counts only answered items', () => {
    const answers = { cable: { kind: 'BOOLEAN' as const, passed: true } };
    expect(answeredCount([booleanItem, textItem], answers)).toBe(1);
  });
});

describe('failedCount', () => {
  it('is zero when nothing failed', () => {
    const answers = { cable: { kind: 'BOOLEAN' as const, passed: true } };
    expect(failedCount([booleanItem, textItem], answers)).toBe(0);
  });

  it('counts boolean items marked fail', () => {
    const answers = { cable: { kind: 'BOOLEAN' as const, passed: false } };
    expect(failedCount([booleanItem], answers)).toBe(1);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { ChecklistItemDiffView } from './checklist-item-diff-view';

afterEach(() => {
  cleanup();
});

const item = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
  key: 'hoist-brake',
  prompt: 'Hoist brake engages and holds load',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
  ...overrides,
});

describe('ChecklistItemDiffView', () => {
  it('shows a no-changes message for an empty diff', () => {
    render(<ChecklistItemDiffView diff={{ added: [], removed: [], changed: [] }} />);
    expect(screen.getByText(/no changes from the active version/i)).toBeDefined();
  });

  it('renders added, removed, and changed sections with correct counts', () => {
    const before = item({ key: 'wire-rope', failSeverity: 'WARNING' });
    const after = item({ key: 'wire-rope', failSeverity: 'BLOCKING' });

    render(
      <ChecklistItemDiffView
        diff={{
          added: [item({ key: 'new-check' })],
          removed: [item({ key: 'old-check' })],
          changed: [{ key: 'wire-rope', before, after }],
        }}
      />,
    );

    expect(screen.getByText(/added \(1\)/i)).toBeDefined();
    expect(screen.getByText(/removed \(1\)/i)).toBeDefined();
    expect(screen.getByText(/changed \(1\)/i)).toBeDefined();
    expect(screen.getByText(/new-check/)).toBeDefined();
    expect(screen.getByText(/old-check/)).toBeDefined();
    expect(screen.getByText(/failSeverity/)).toBeDefined();
  });
});

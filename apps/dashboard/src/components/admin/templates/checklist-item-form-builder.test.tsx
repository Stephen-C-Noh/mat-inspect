// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { ChecklistItemFormBuilder } from './checklist-item-form-builder';

afterEach(() => {
  cleanup();
});

const items: ChecklistItem[] = [
  {
    key: 'hoist-brake',
    prompt: 'Hoist brake engages and holds load',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'wire-rope',
    prompt: 'Wire rope free of kinks or broken strands',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
  },
];

describe('ChecklistItemFormBuilder', () => {
  it('adds a blank item and calls onChange with it appended', async () => {
    const onChange = vi.fn();
    render(<ChecklistItemFormBuilder items={items} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /add item/i }));

    expect(onChange).toHaveBeenCalledWith([
      ...items,
      expect.objectContaining({ key: '', type: 'BOOLEAN' }),
    ]);
  });

  it('removes an item at the given row', async () => {
    const onChange = vi.fn();
    render(<ChecklistItemFormBuilder items={items} onChange={onChange} />);

    await userEvent.click(screen.getAllByRole('button', { name: /remove item/i })[0]!);

    expect(onChange).toHaveBeenCalledWith([items[1]]);
  });

  it('edits the prompt field for a row', async () => {
    // A fully controlled component only shows a keystroke once its new value comes back
    // through props, so this needs a real re-rendering harness, not a static onChange spy.
    const onChangeSpy = vi.fn();
    const Harness = () => {
      const [state, setState] = useState(items);
      return (
        <ChecklistItemFormBuilder
          items={state}
          onChange={(next) => {
            onChangeSpy(next);
            setState(next);
          }}
        />
      );
    };
    render(<Harness />);

    const promptInput = screen.getByDisplayValue(items[0]!.prompt);
    await userEvent.clear(promptInput);
    await userEvent.type(promptInput, 'Updated prompt');

    const lastCall = onChangeSpy.mock.calls.at(-1)![0] as ChecklistItem[];
    expect(lastCall[0]!.prompt).toBe('Updated prompt');
    expect(lastCall[1]).toEqual(items[1]);
  });

  it('maps an empty regulatory reference to undefined', async () => {
    const onChangeSpy = vi.fn();
    const withRef: ChecklistItem[] = [{ ...items[0]!, regulatoryReference: 'OHS s.257' }];
    const Harness = () => {
      const [state, setState] = useState(withRef);
      return (
        <ChecklistItemFormBuilder
          items={state}
          onChange={(next) => {
            onChangeSpy(next);
            setState(next);
          }}
        />
      );
    };
    render(<Harness />);

    const refInput = screen.getByDisplayValue('OHS s.257');
    await userEvent.clear(refInput);

    const lastCall = onChangeSpy.mock.calls.at(-1)![0] as ChecklistItem[];
    expect(lastCall[0]!.regulatoryReference).toBeUndefined();
  });

  it('moves an item down and swaps order', async () => {
    const onChange = vi.fn();
    render(<ChecklistItemFormBuilder items={items} onChange={onChange} />);

    await userEvent.click(screen.getAllByRole('button', { name: /move item down/i })[0]!);

    expect(onChange).toHaveBeenCalledWith([items[1], items[0]]);
  });
});

import { describe, expect, it } from 'vitest';
import { computeInspectionContentHash, type ContentHashInput } from './content-hash.js';

const baseInput: ContentHashInput = {
  inspectionId: 'b1f9b9b0-0000-4000-8000-000000000001',
  equipmentId: 'b1f9b9b0-0000-4000-8000-000000000002',
  operatorId: 'b1f9b9b0-0000-4000-8000-000000000003',
  templateId: 'b1f9b9b0-0000-4000-8000-000000000004',
  templateVersion: 1,
  result: 'PASS',
  submittedAt: '2026-05-19T18:31:42.123Z',
  responses: [
    { itemKey: 'brakes', value: true, passed: true, notes: null, notesSource: null },
    { itemKey: 'horn', value: true, passed: true, notes: null, notesSource: null },
  ],
};

describe('computeInspectionContentHash', () => {
  it('is deterministic for the same input', () => {
    expect(computeInspectionContentHash(baseInput)).toBe(computeInspectionContentHash(baseInput));
  });

  it('does not depend on the order responses are passed in', () => {
    const reordered: ContentHashInput = {
      ...baseInput,
      responses: [...baseInput.responses].reverse(),
    };
    expect(computeInspectionContentHash(baseInput)).toBe(computeInspectionContentHash(reordered));
  });

  it('changes when a response passed flag is tampered with', () => {
    const tampered: ContentHashInput = {
      ...baseInput,
      responses: [{ ...baseInput.responses[0]!, passed: false }, baseInput.responses[1]!],
    };
    expect(computeInspectionContentHash(tampered)).not.toBe(
      computeInspectionContentHash(baseInput),
    );
  });

  it('changes when a response value is tampered with', () => {
    const tampered: ContentHashInput = {
      ...baseInput,
      responses: [{ ...baseInput.responses[0]!, value: false }, baseInput.responses[1]!],
    };
    expect(computeInspectionContentHash(tampered)).not.toBe(
      computeInspectionContentHash(baseInput),
    );
  });

  it('changes when notes are tampered with', () => {
    const tampered: ContentHashInput = {
      ...baseInput,
      responses: [
        { ...baseInput.responses[0]!, notes: 'looks fine', notesSource: 'TYPED' },
        baseInput.responses[1]!,
      ],
    };
    expect(computeInspectionContentHash(tampered)).not.toBe(
      computeInspectionContentHash(baseInput),
    );
  });

  it('changes when the result is tampered with', () => {
    const tampered: ContentHashInput = { ...baseInput, result: 'FAIL_BLOCKING' };
    expect(computeInspectionContentHash(tampered)).not.toBe(
      computeInspectionContentHash(baseInput),
    );
  });

  it('changes when a response is added or removed', () => {
    const tampered: ContentHashInput = { ...baseInput, responses: [baseInput.responses[0]!] };
    expect(computeInspectionContentHash(tampered)).not.toBe(
      computeInspectionContentHash(baseInput),
    );
  });
});

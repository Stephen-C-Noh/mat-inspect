import { describe, expect, it } from 'vitest';
import { checklistTemplateSchema } from '@mat-inspect/shared-schemas';
import { serializeChecklistTemplate } from './serialize.js';

const row = {
  id: '22222222-2222-2222-2222-222222222222',
  equipmentType: 'FORKLIFT' as const,
  version: 2,
  isActive: true,
  effectiveFrom: new Date('2026-06-10T12:00:00.000Z'),
  items: [
    {
      key: 'forks-condition',
      prompt: 'Forks free of cracks, bends, and excessive wear',
      type: 'BOOLEAN' as const,
      required: true,
      failSeverity: 'BLOCKING' as const,
      regulatoryReference: 'OHS Part 19 s.257',
    },
    {
      key: 'horn',
      prompt: 'Horn sounds when tested',
      type: 'BOOLEAN' as const,
      required: true,
      failSeverity: 'WARNING' as const,
    },
  ],
  createdBy: '11111111-1111-1111-1111-111111111111',
  reviewedBy: null,
  createdAt: new Date('2026-06-01T09:00:00.000Z'),
};

describe('serializeChecklistTemplate', () => {
  it('maps a Drizzle row to a value that conforms to checklistTemplateSchema', () => {
    const dto = serializeChecklistTemplate(row);

    // Throws if the mapped value does not match the shared client contract.
    expect(() => checklistTemplateSchema.parse(dto)).not.toThrow();
  });

  it('renders Date columns as ISO 8601 strings', () => {
    const dto = serializeChecklistTemplate(row);

    expect(dto.effectiveFrom).toBe('2026-06-10T12:00:00.000Z');
    expect(dto.createdAt).toBe('2026-06-01T09:00:00.000Z');
  });

  it('passes through items and a null reviewedBy', () => {
    const dto = serializeChecklistTemplate(row);

    expect(dto.items).toEqual(row.items);
    expect(dto.reviewedBy).toBeNull();
  });
});

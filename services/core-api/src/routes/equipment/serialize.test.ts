import { describe, expect, it } from 'vitest';
import { equipmentSchema } from '@mat-inspect/shared-schemas';
import { serializeEquipment } from './serialize.js';

const row = {
  id: '11111111-1111-1111-1111-111111111111',
  assetTag: 'CRANE-01',
  name: 'Overhead Crane 1',
  type: 'OVERHEAD_CRANE' as const,
  make: 'Konecranes',
  model: 'CXT',
  serialNumber: 'SN-123',
  manufacturerSpecsUrl: null,
  status: 'AWAITING_INSPECTION' as const,
  currentStatusSince: new Date('2026-06-10T12:00:00.000Z'),
  readinessBaselineAt: new Date('2026-06-01T09:00:00.000Z'),
  location: 'Bay 4',
  createdAt: new Date('2026-06-01T09:00:00.000Z'),
  updatedAt: new Date('2026-06-10T12:00:00.000Z'),
};

describe('serializeEquipment', () => {
  it('maps a Drizzle row to a value that conforms to equipmentSchema', () => {
    const dto = serializeEquipment(row, 'READY');

    // Throws if the mapped value does not match the shared client contract.
    expect(() => equipmentSchema.parse(dto)).not.toThrow();
  });

  it('uses the computed status, not the stored row status', () => {
    const dto = serializeEquipment(row, 'READY');

    expect(dto.status).toBe('READY');
  });

  it('renders Date columns as ISO 8601 strings', () => {
    const dto = serializeEquipment(row, 'READY');

    expect(dto.currentStatusSince).toBe('2026-06-10T12:00:00.000Z');
    expect(dto.createdAt).toBe('2026-06-01T09:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-06-10T12:00:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import type { Defect, Equipment } from '@mat-inspect/shared-schemas';
import {
  findEquipment,
  formatAge,
  isActive,
  isNewToday,
  isPendingApproval,
  isQueueOpen,
  shortCode,
} from './defect-queue';

const makeDefect = (overrides: Partial<Defect> = {}): Defect => ({
  id: '11111111-1111-1111-1111-111111111111',
  inspectionId: '22222222-2222-2222-2222-222222222222',
  equipmentId: '33333333-3333-3333-3333-333333333333',
  itemKey: 'hydraulic_system',
  severity: 'BLOCKING',
  description: 'Hydraulic leak at the mast',
  photoIds: [],
  status: 'OPEN',
  openedAt: '2026-07-20T15:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
  resolutionNotes: null,
  returnToServiceApprovedBy: null,
  ...overrides,
});

const makeEquipment = (overrides: Partial<Equipment> = {}): Equipment => ({
  id: '33333333-3333-3333-3333-333333333333',
  assetTag: 'MAT-FL-001',
  name: 'Forklift 1',
  type: 'FORKLIFT',
  make: 'Toyota',
  model: '8FGCU25',
  serialNumber: 'SN-123',
  location: 'Warehouse A',
  status: 'OUT_OF_SERVICE',
  currentStatusSince: '2026-07-20T14:00:00.000Z',
  manufacturerSpecsUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-07-20T14:00:00.000Z',
  ...overrides,
});

describe('isQueueOpen', () => {
  it('keeps every non-terminal status in the queue', () => {
    for (const status of ['OPEN', 'ACKNOWLEDGED', 'IN_REPAIR'] as const) {
      expect(isQueueOpen(makeDefect({ status }))).toBe(true);
    }
  });

  it('drops REJECTED defects regardless of severity', () => {
    expect(isQueueOpen(makeDefect({ status: 'REJECTED', severity: 'BLOCKING' }))).toBe(false);
    expect(isQueueOpen(makeDefect({ status: 'REJECTED', severity: 'WARNING' }))).toBe(false);
  });

  it('clears a RESOLVED WARNING defect immediately (no return-to-service gate)', () => {
    expect(isQueueOpen(makeDefect({ status: 'RESOLVED', severity: 'WARNING' }))).toBe(false);
  });

  it('keeps a RESOLVED BLOCKING defect until return-to-service is approved (ADR 0006)', () => {
    expect(
      isQueueOpen(
        makeDefect({ status: 'RESOLVED', severity: 'BLOCKING', returnToServiceApprovedBy: null }),
      ),
    ).toBe(true);
    expect(
      isQueueOpen(
        makeDefect({
          status: 'RESOLVED',
          severity: 'BLOCKING',
          returnToServiceApprovedBy: '44444444-4444-4444-4444-444444444444',
        }),
      ),
    ).toBe(false);
  });
});

describe('isPendingApproval', () => {
  it('is true only for a RESOLVED BLOCKING defect not yet approved', () => {
    expect(
      isPendingApproval(
        makeDefect({ status: 'RESOLVED', severity: 'BLOCKING', returnToServiceApprovedBy: null }),
      ),
    ).toBe(true);
  });

  it('is false once return-to-service is approved', () => {
    expect(
      isPendingApproval(
        makeDefect({
          status: 'RESOLVED',
          severity: 'BLOCKING',
          returnToServiceApprovedBy: '44444444-4444-4444-4444-444444444444',
        }),
      ),
    ).toBe(false);
  });

  it('is false for WARNING severity and for non-RESOLVED statuses', () => {
    expect(isPendingApproval(makeDefect({ status: 'RESOLVED', severity: 'WARNING' }))).toBe(false);
    expect(isPendingApproval(makeDefect({ status: 'IN_REPAIR', severity: 'BLOCKING' }))).toBe(
      false,
    );
  });

  // isQueueOpen delegates its RESOLVED branch to isPendingApproval, so the two must agree there.
  it('matches isQueueOpen on the RESOLVED BLOCKING boundary', () => {
    const pending = makeDefect({
      status: 'RESOLVED',
      severity: 'BLOCKING',
      returnToServiceApprovedBy: null,
    });
    expect(isPendingApproval(pending)).toBe(isQueueOpen(pending));
  });
});

describe('isActive', () => {
  it('is true for ACKNOWLEDGED and IN_REPAIR only', () => {
    expect(isActive(makeDefect({ status: 'ACKNOWLEDGED' }))).toBe(true);
    expect(isActive(makeDefect({ status: 'IN_REPAIR' }))).toBe(true);
    expect(isActive(makeDefect({ status: 'OPEN' }))).toBe(false);
    expect(isActive(makeDefect({ status: 'RESOLVED' }))).toBe(false);
  });
});

describe('isNewToday', () => {
  it('is true for a defect opened in the current lab-local day', () => {
    expect(isNewToday(makeDefect({ openedAt: new Date().toISOString() }))).toBe(true);
  });

  it('is false for a defect opened on an earlier calendar day', () => {
    expect(isNewToday(makeDefect({ openedAt: '2020-01-01T12:00:00.000Z' }))).toBe(false);
  });
});

describe('findEquipment', () => {
  it('returns the matching equipment by id', () => {
    const fleet = [makeEquipment({ id: 'a' }), makeEquipment({ id: 'b', name: 'Crane' })];
    expect(findEquipment(fleet, 'b')?.name).toBe('Crane');
  });

  it('returns undefined for an unknown id or an undefined list', () => {
    expect(findEquipment([makeEquipment({ id: 'a' })], 'missing')).toBeUndefined();
    expect(findEquipment(undefined, 'a')).toBeUndefined();
  });
});

describe('shortCode', () => {
  it('formats a trailing number with a zero-padded prefix', () => {
    expect(shortCode('DEF', 'defect-42')).toBe('DEF-0042');
    expect(shortCode('INS', 'inspection-7')).toBe('INS-0007');
  });

  it('falls back to an uppercased id slice when there is no trailing number', () => {
    expect(shortCode('DEF', 'deadbeef-cafe')).toBe('DEADBEEF');
  });
});

describe('formatAge', () => {
  it('renders minute, hour, and day buckets', () => {
    const now = Date.now();
    expect(formatAge(new Date(now - 30_000).toISOString())).toBe('0m');
    expect(formatAge(new Date(now - 5 * 60_000).toISOString())).toBe('5m');
    expect(formatAge(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h');
    expect(formatAge(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d');
  });
});

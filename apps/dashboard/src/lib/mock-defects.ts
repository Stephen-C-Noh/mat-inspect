import type { Defect } from '@mat-inspect/shared-schemas';
import type { DefectStatus } from '@mat-inspect/shared-types';

// Temporary stand-in for DEV-20's defect lifecycle API (services/core-api/src/routes/defects/*,
// branch DEV-20-Defect-Lifecycle-ADR006, unmerged). Mirrors that branch's transitions.ts and
// return-to-service rule so the hooks in ../hooks only need their call sites changed, not
// reshaped, once the branch merges. Delete this file when that happens.

type MockEquipment = { id: string; name: string };

export const MOCK_EQUIPMENT: MockEquipment[] = [
  { id: 'eq-oc-102', name: 'Overhead Crane TD102' },
  { id: 'eq-tr-chevy', name: 'Truck (Chevrolet)' },
  { id: 'eq-fl-1', name: 'Forklift 1' },
];

const DEFECT_TRANSITIONS: Record<DefectStatus, DefectStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'REJECTED'],
  ACKNOWLEDGED: ['IN_REPAIR', 'REJECTED'],
  IN_REPAIR: ['RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
};

const assertCanTransition = (from: DefectStatus, to: DefectStatus): void => {
  if (!DEFECT_TRANSITIONS[from].includes(to)) {
    throw new Error(`Cannot move defect from ${from} to ${to}`);
  }
};

let mockDefects: Defect[] = [
  {
    id: 'defect-1',
    inspectionId: 'inspection-1',
    equipmentId: 'eq-oc-102',
    itemKey: 'hoist_brake',
    severity: 'BLOCKING',
    description: 'Hoist brake does not fully release on descent.',
    photoIds: [],
    status: 'OPEN',
    openedAt: '2026-07-14T13:05:00Z',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    returnToServiceApprovedBy: null,
  },
  {
    id: 'defect-2',
    inspectionId: 'inspection-1',
    equipmentId: 'eq-oc-102',
    itemKey: 'wire_rope',
    severity: 'WARNING',
    description: 'Minor fraying on main wire rope, within tolerance.',
    photoIds: [],
    status: 'ACKNOWLEDGED',
    openedAt: '2026-07-14T13:05:00Z',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    returnToServiceApprovedBy: null,
  },
  {
    id: 'defect-3',
    inspectionId: 'inspection-2',
    equipmentId: 'eq-tr-chevy',
    itemKey: 'headlights',
    severity: 'BLOCKING',
    description: 'Left headlight inoperative.',
    photoIds: [],
    status: 'IN_REPAIR',
    openedAt: '2026-07-13T09:20:00Z',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    returnToServiceApprovedBy: null,
  },
  {
    id: 'defect-4',
    inspectionId: 'inspection-3',
    equipmentId: 'eq-fl-1',
    itemKey: 'fork_tines',
    severity: 'BLOCKING',
    description: 'Left fork tine has a visible crack near the heel.',
    photoIds: [],
    status: 'RESOLVED',
    openedAt: '2026-07-12T08:00:00Z',
    resolvedAt: '2026-07-12T15:30:00Z',
    resolvedBy: 'user-supervisor-1',
    resolutionNotes: 'Tine replaced and load-tested.',
    returnToServiceApprovedBy: null,
  },
];

type ListDefectsFilter = { equipmentId?: string; status?: DefectStatus };

export const listDefects = async (filter: ListDefectsFilter = {}): Promise<Defect[]> => {
  return mockDefects
    .filter((d) => !filter.equipmentId || d.equipmentId === filter.equipmentId)
    .filter((d) => !filter.status || d.status === filter.status)
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
};

const updateDefect = (id: string, to: DefectStatus, patch: Partial<Defect> = {}): Defect => {
  const index = mockDefects.findIndex((d) => d.id === id);
  if (index === -1) throw new Error(`Defect not found: ${id}`);

  const current = mockDefects[index]!;
  assertCanTransition(current.status, to);

  const updated: Defect = { ...current, ...patch, status: to };
  mockDefects = [...mockDefects.slice(0, index), updated, ...mockDefects.slice(index + 1)];
  return updated;
};

export const acknowledgeDefect = async (id: string): Promise<Defect> => {
  return updateDefect(id, 'ACKNOWLEDGED');
};

export const startRepairDefect = async (id: string): Promise<Defect> => {
  return updateDefect(id, 'IN_REPAIR');
};

export const resolveDefect = async (id: string, resolutionNotes: string): Promise<Defect> => {
  return updateDefect(id, 'RESOLVED', {
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'mock-current-user',
    resolutionNotes,
  });
};

// Mirrors DEV-20's return-to-service.ts: allowed only once every BLOCKING defect for the
// equipment is RESOLVED (no OPEN/ACKNOWLEDGED/IN_REPAIR blocking defect left).
export const returnToService = async (equipmentId: string): Promise<void> => {
  const blockingOpen = mockDefects.some(
    (d) =>
      d.equipmentId === equipmentId &&
      d.severity === 'BLOCKING' &&
      d.status !== 'RESOLVED' &&
      d.status !== 'REJECTED',
  );

  if (blockingOpen) {
    throw new Error('Equipment still has an open blocking defect');
  }

  const hasResolvedBlocking = mockDefects.some(
    (d) => d.equipmentId === equipmentId && d.severity === 'BLOCKING' && d.status === 'RESOLVED',
  );

  if (!hasResolvedBlocking) {
    throw new Error('No resolved blocking defect to approve return-to-service for');
  }

  mockDefects = mockDefects.map((d) =>
    d.equipmentId === equipmentId && d.severity === 'BLOCKING' && d.status === 'RESOLVED'
      ? { ...d, returnToServiceApprovedBy: 'mock-current-user' }
      : d,
  );
};

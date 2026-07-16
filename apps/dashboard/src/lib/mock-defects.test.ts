import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MockDefects from './mock-defects';

// Each test re-imports the module fresh since mock-defects keeps its defect list as
// module-level state (mirrors a real backend's persistence for the lifetime of a request,
// not something a UI-layer test should reach in and reset by hand).
let mod: typeof MockDefects;

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./mock-defects');
});

describe('defect lifecycle transitions', () => {
  it('walks OPEN -> ACKNOWLEDGED -> IN_REPAIR -> RESOLVED', async () => {
    await mod.acknowledgeDefect('defect-1');
    await mod.startRepairDefect('defect-1');
    const resolved = await mod.resolveDefect('defect-1', 'Brake replaced and tested.');

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionNotes).toBe('Brake replaced and tested.');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('rejects an invalid transition (OPEN -> IN_REPAIR)', async () => {
    await expect(mod.startRepairDefect('defect-1')).rejects.toThrow(
      'Cannot move defect from OPEN to IN_REPAIR',
    );
  });

  it('rejects acting on an already-RESOLVED defect', async () => {
    await expect(mod.acknowledgeDefect('defect-4')).rejects.toThrow(
      'Cannot move defect from RESOLVED to ACKNOWLEDGED',
    );
  });
});

describe('return to service gating', () => {
  it('blocks return-to-service while a BLOCKING defect is still open', async () => {
    // defect-1 (BLOCKING, OPEN) belongs to eq-oc-102
    await expect(mod.returnToService('eq-oc-102')).rejects.toThrow(
      'Equipment still has an open blocking defect',
    );
  });

  it('allows return-to-service once every BLOCKING defect is RESOLVED', async () => {
    // defect-4 (BLOCKING, RESOLVED) is the only defect on eq-fl-1
    await expect(mod.returnToService('eq-fl-1')).resolves.toBeUndefined();

    const defects = await mod.listDefects({ equipmentId: 'eq-fl-1' });
    expect(defects[0]?.returnToServiceApprovedBy).not.toBeNull();
  });

  it('rejects return-to-service when there is no resolved blocking defect at all', async () => {
    // eq-tr-chevy only has defect-3 (BLOCKING, IN_REPAIR) — none RESOLVED yet
    await expect(mod.returnToService('eq-tr-chevy')).rejects.toThrow(
      'Equipment still has an open blocking defect',
    );
  });
});

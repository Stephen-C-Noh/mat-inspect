import { describe, expect, it } from 'vitest';
import { msUntilNext } from './schedule.js';

describe('msUntilNext', () => {
  it('returns ms until later today when the target time has not passed yet', () => {
    const now = new Date(2026, 0, 15, 1, 0, 0, 0); // 01:00
    expect(msUntilNext('02:30', now)).toBe(90 * 60 * 1000); // 1h30m
  });

  it('rolls to tomorrow when the target time has already passed today', () => {
    const now = new Date(2026, 0, 15, 3, 0, 0, 0); // 03:00
    const expectedTarget = new Date(2026, 0, 16, 2, 30, 0, 0);
    expect(msUntilNext('02:30', now)).toBe(expectedTarget.getTime() - now.getTime());
  });

  it('rolls to tomorrow at the exact boundary (now === target)', () => {
    const now = new Date(2026, 0, 15, 2, 30, 0, 0);
    const expectedTarget = new Date(2026, 0, 16, 2, 30, 0, 0);
    expect(msUntilNext('02:30', now)).toBe(expectedTarget.getTime() - now.getTime());
  });
});

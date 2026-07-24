import { describe, expect, it } from 'vitest';
import { msUntilNext } from './schedule.js';

const ZONE = 'America/Edmonton';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Wall-clock HH:MM that `instant` shows in ZONE. Used to assert the invariant that matters (the
// job fires at 02:30 lab-local) independently of the machine the test runs on.
const wallClockHHMM = (instant: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);

// `now` values are given as explicit UTC instants so these assertions do not depend on the
// timezone of the machine running the tests. Edmonton is UTC-7 in January (MST) and UTC-6 in
// July (MDT), so 02:30 lab-local is 09:30 UTC in winter and 08:30 UTC in summer.
describe('msUntilNext', () => {
  it('returns ms until later today when the target time has not passed yet (winter)', () => {
    const now = new Date('2026-01-15T08:00:00Z'); // 01:00 MST
    expect(msUntilNext('02:30', ZONE, now)).toBe(90 * MINUTE); // → 09:30 UTC same day
  });

  it('rolls to tomorrow when the target time has already passed today (winter)', () => {
    const now = new Date('2026-01-15T10:00:00Z'); // 03:00 MST
    expect(msUntilNext('02:30', ZONE, now)).toBe(23.5 * HOUR); // → next day 09:30 UTC
  });

  it('rolls to tomorrow at the exact boundary (now === target)', () => {
    const now = new Date('2026-01-15T09:30:00Z'); // exactly 02:30 MST
    expect(msUntilNext('02:30', ZONE, now)).toBe(24 * HOUR);
  });

  it('tracks the DST offset in summer (MDT, UTC-6)', () => {
    const now = new Date('2026-07-15T06:00:00Z'); // 00:00 MDT
    expect(msUntilNext('02:30', ZONE, now)).toBe(150 * MINUTE); // → 08:30 UTC same day
  });

  it('always lands on 02:30 lab-local, in both winter and summer', () => {
    for (const iso of ['2026-01-15T08:00:00Z', '2026-07-15T06:00:00Z', '2026-11-01T12:00:00Z']) {
      const now = new Date(iso);
      const fireAt = new Date(now.getTime() + msUntilNext('02:30', ZONE, now));
      expect(wallClockHHMM(fireAt)).toBe('02:30');
    }
  });
});

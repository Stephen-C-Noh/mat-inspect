import { describe, expect, it } from 'vitest';
import { computeCutoff, isExpired } from './voice-retention.js';

// Docker-free unit coverage of the age decision. The full purge behaviour (list, delete,
// idempotency, missing container) is exercised against Azurite in the integration test.

describe('computeCutoff', () => {
  it('subtracts the retention window from now', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    // 90 days before 2026-07-22 is 2026-04-23.
    expect(computeCutoff(now, 90).toISOString()).toBe('2026-04-23T00:00:00.000Z');
  });

  it('honours a shorter window', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    expect(computeCutoff(now, 30).toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });
});

describe('isExpired', () => {
  const cutoff = new Date('2026-04-23T00:00:00.000Z');

  it('purges a clip created before the cutoff', () => {
    expect(isExpired(new Date('2026-04-22T23:59:59.999Z'), cutoff)).toBe(true);
  });

  it('keeps a clip created exactly at the cutoff', () => {
    // "older than 90 days" is strict: a clip exactly 90 days old is still inside retention.
    expect(isExpired(new Date('2026-04-23T00:00:00.000Z'), cutoff)).toBe(false);
  });

  it('keeps a clip created after the cutoff', () => {
    expect(isExpired(new Date('2026-07-01T00:00:00.000Z'), cutoff)).toBe(false);
  });

  it('keeps a clip whose creation time is unknown', () => {
    // Fail safe toward retention: never delete a blob whose age cannot be established.
    expect(isExpired(undefined, cutoff)).toBe(false);
  });
});

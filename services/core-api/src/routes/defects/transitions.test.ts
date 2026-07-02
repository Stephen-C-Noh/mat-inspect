import { describe, expect, it } from 'vitest';
import { HttpError } from '../../lib/http-error.js';
import { DEFECT_TRANSITIONS, assertCanTransition } from './transitions.js';

describe('defect state machine', () => {
  it('allows the happy path OPEN -> ACKNOWLEDGED -> IN_REPAIR -> RESOLVED', () => {
    expect(() => assertCanTransition('OPEN', 'ACKNOWLEDGED')).not.toThrow();
    expect(() => assertCanTransition('ACKNOWLEDGED', 'IN_REPAIR')).not.toThrow();
    expect(() => assertCanTransition('IN_REPAIR', 'RESOLVED')).not.toThrow();
  });

  it('allows REJECTED from every non-terminal state', () => {
    expect(() => assertCanTransition('OPEN', 'REJECTED')).not.toThrow();
    expect(() => assertCanTransition('ACKNOWLEDGED', 'REJECTED')).not.toThrow();
    expect(() => assertCanTransition('IN_REPAIR', 'REJECTED')).not.toThrow();
  });

  it('rejects skipping states, e.g. OPEN straight to RESOLVED', () => {
    expect(() => assertCanTransition('OPEN', 'RESOLVED')).toThrow(HttpError);
    expect(() => assertCanTransition('OPEN', 'IN_REPAIR')).toThrow(HttpError);
  });

  it('treats RESOLVED and REJECTED as terminal', () => {
    expect(DEFECT_TRANSITIONS.RESOLVED).toEqual([]);
    expect(DEFECT_TRANSITIONS.REJECTED).toEqual([]);
    expect(() => assertCanTransition('RESOLVED', 'IN_REPAIR')).toThrow(HttpError);
  });

  it('raises a 409 with the DEFECT_INVALID_TRANSITION code', () => {
    try {
      assertCanTransition('OPEN', 'RESOLVED');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
      expect((err as HttpError).code).toBe('DEFECT_INVALID_TRANSITION');
    }
  });
});

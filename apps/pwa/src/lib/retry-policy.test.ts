import { describe, expect, it, vi } from 'vitest';
import { runWithRetry, submissionRetry, uploadRetry, RetryExhaustedError } from './retry-policy';

const network = { kind: 'network' } as const;
const http = (status: number) => ({ kind: 'http', status }) as const;

describe('submission retry policy', () => {
  // ADR 0025 and FRS 9.1: 1s, 2s, 4s, 8s, then the backoff caps and retries continue at 8s.
  it('backs off 1s, 2s, 4s, 8s and then holds at 8s', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((attempt) => {
      const decision = submissionRetry({ attempt, elapsedMs: 0, outcome: network });
      return decision.retry ? decision.delayMs : null;
    });

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  });

  // AC-9.1.3: after 15 minutes the operator is asked to retry manually. Unlike an upload, a
  // submission represents an already completed walkaround, so it gets the long window.
  it('keeps retrying up to 15 minutes and then asks the operator', () => {
    const justInside = submissionRetry({
      attempt: 40,
      elapsedMs: 14 * 60_000 + 59_000,
      outcome: network,
    });
    const past = submissionRetry({ attempt: 40, elapsedMs: 15 * 60_000, outcome: network });

    expect(justInside).toEqual({ retry: true, delayMs: 8_000 });
    expect(past).toEqual({ retry: false, reason: 'exhausted' });
  });

  // Retrying a rejected request cannot succeed, and a spinner that runs for 15 minutes on a
  // permanent rejection hides the real problem. 409 is the idempotency mismatch FRS 4.x calls a
  // client bug; 403 is a role or certification rejection. Neither improves by waiting.
  it.each([[400], [403], [409], [422]])('stops immediately on HTTP %i', (status) => {
    expect(submissionRetry({ attempt: 1, elapsedMs: 0, outcome: http(status) })).toEqual({
      retry: false,
      reason: 'not-retryable',
    });
  });

  // A timeout and a rate limit are the two 4xx codes that do clear on their own, and 5xx is the
  // server asking to be tried again. These are the drops the short-drop model exists for.
  it.each([[408], [429], [500], [502], [503], [504]])('retries HTTP %i', (status) => {
    expect(submissionRetry({ attempt: 1, elapsedMs: 0, outcome: http(status) })).toEqual({
      retry: true,
      delayMs: 1_000,
    });
  });
});

describe('upload retry policy', () => {
  it('backs off 1s, 2s, 4s, 8s and then gives up', () => {
    const decisions = [1, 2, 3, 4, 5].map((attempt) => uploadRetry({ attempt, outcome: network }));

    expect(decisions).toEqual([
      { retry: true, delayMs: 1_000 },
      { retry: true, delayMs: 2_000 },
      { retry: true, delayMs: 4_000 },
      { retry: true, delayMs: 8_000 },
      { retry: false, reason: 'exhausted' },
    ]);
  });
});

describe('runWithRetry', () => {
  // A controllable clock and sleep, so the 15-minute window is exercised without waiting for it.
  const harness = () => {
    let nowMs = 0;
    const slept: number[] = [];
    return {
      slept,
      clock: () => nowMs,
      sleep: async (ms: number) => {
        slept.push(ms);
        nowMs += ms;
      },
      advance: (ms: number) => {
        nowMs += ms;
      },
    };
  };

  it('returns the value without sleeping when the first attempt succeeds', async () => {
    const h = harness();
    const attempt = vi.fn().mockResolvedValue('ok');

    await expect(runWithRetry(attempt, submissionRetry, h)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(h.slept).toEqual([]);
  });

  // AC-9.1.1: a 30-second drop is transparent to the operator, the submission succeeds on a retry.
  it('retries a dropped attempt and returns the eventual success', async () => {
    const h = harness();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce({ kind: 'network' })
      .mockRejectedValueOnce({ kind: 'network' })
      .mockResolvedValue('ok');

    await expect(runWithRetry(attempt, submissionRetry, h)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(h.slept).toEqual([1_000, 2_000]);
  });

  it('stops on a rejection that retrying cannot fix', async () => {
    const h = harness();
    const attempt = vi.fn().mockRejectedValue({ kind: 'http', status: 409 });

    await expect(runWithRetry(attempt, submissionRetry, h)).rejects.toBeInstanceOf(
      RetryExhaustedError,
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  // The window is wall-clock, not attempt-count: a drop that outlasts 15 minutes ends in the
  // manual-retry state however many attempts fitted into it.
  it('gives up once the retry window has passed', async () => {
    const h = harness();
    const attempt = vi.fn().mockRejectedValue({ kind: 'network' });

    const promise = runWithRetry(attempt, submissionRetry, h);
    await expect(promise).rejects.toMatchObject({ reason: 'exhausted' });
    // 1s + 2s + 4s + 8s, then 8s a further 112 times, is the first sleep past 15 minutes.
    expect(h.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(15 * 60_000);
  });
});

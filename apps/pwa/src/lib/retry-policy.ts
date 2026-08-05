// How the PWA reacts to a failed network call during an inspection. The schedule and the
// 15-minute ceiling come from ADR 0025 and FRS section 9.1; this module is the single place that
// encodes them, so the two call sites cannot drift from the specification or from each other.

// What came back from the attempt. A network-level failure (offline, DNS, timeout) carries no
// status; an HTTP response does.
export type AttemptOutcome = { kind: 'network' } | { kind: 'http'; status: number };

export type RetryDecision =
  | { retry: true; delayMs: number }
  // 'exhausted' means the operator is asked to retry manually; the payload is kept either way.
  // 'not-retryable' means retrying cannot help, so asking the operator to wait would mislead them.
  | { retry: false; reason: 'exhausted' | 'not-retryable' };

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];

// FRS AC-9.1.3. A submission is an already completed walkaround, so it is worth holding for the
// full window; an upload is not, because the operator is still at the capture screen.
const SUBMISSION_WINDOW_MS = 15 * 60_000;

// 408 clears when the network settles and 429 clears when the window rolls. Every other 4xx is the
// server saying the request itself is wrong, so waiting cannot change the answer.
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

const isRetryable = (outcome: AttemptOutcome): boolean => {
  if (outcome.kind === 'network') return true;
  if (outcome.status >= 500) return true;
  return RETRYABLE_CLIENT_STATUSES.has(outcome.status);
};

// Attempt is 1-based: the delay to wait before attempt N+1.
const backoffFor = (attempt: number): number =>
  BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1]!;

export const submissionRetry = (params: {
  attempt: number;
  elapsedMs: number;
  outcome: AttemptOutcome;
}): RetryDecision => {
  if (!isRetryable(params.outcome)) return { retry: false, reason: 'not-retryable' };
  if (params.elapsedMs >= SUBMISSION_WINDOW_MS) return { retry: false, reason: 'exhausted' };
  return { retry: true, delayMs: backoffFor(params.attempt) };
};

export const uploadRetry = (params: {
  attempt: number;
  outcome: AttemptOutcome;
}): RetryDecision => {
  if (!isRetryable(params.outcome)) return { retry: false, reason: 'not-retryable' };
  if (params.attempt > BACKOFF_MS.length) return { retry: false, reason: 'exhausted' };
  return { retry: true, delayMs: backoffFor(params.attempt) };
};

// Thrown once retrying is over. `reason` separates the two states the operator sees: 'exhausted'
// offers a manual retry (the payload is still held), 'not-retryable' reports a rejection that a
// retry cannot clear. `cause` keeps the underlying failure for logging.
export class RetryExhaustedError extends Error {
  constructor(
    readonly reason: 'exhausted' | 'not-retryable',
    readonly attempts: number,
    override readonly cause: unknown,
  ) {
    super(`gave up after ${attempts} attempt(s): ${reason}`);
    this.name = 'RetryExhaustedError';
  }
}

type Policy = (params: {
  attempt: number;
  elapsedMs: number;
  outcome: AttemptOutcome;
}) => RetryDecision;

// Clock and sleep are injected so the 15-minute window can be exercised in a test without waiting
// for it, and so this module needs no timer globals.
export type RetryRuntime = {
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const defaultRetryRuntime: RetryRuntime = {
  clock: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Raised by a caller that got an HTTP response, so the policy can tell a 503 (worth retrying)
// from a 409 (never worth retrying) instead of treating every rejection as a transport failure.
// `title` is the server's RFC 7807 problem code (app.ts's error handler sets it to the httpError
// `code`), carried through so a caller can give the operator a reason instead of a generic
// rejection message (code review on DEV-143), not just a retry/no-retry decision.
export class HttpAttemptError extends Error {
  readonly kind = 'http';

  constructor(
    readonly status: number,
    readonly title?: string,
  ) {
    super(`request failed with status ${status}`);
    this.name = 'HttpAttemptError';
  }
}

const asOutcome = (err: unknown): AttemptOutcome => {
  if (typeof err === 'object' && err !== null && 'kind' in err) return err as AttemptOutcome;
  // An exception that is not a classified outcome (a thrown TypeError from fetch, say) is a
  // transport failure as far as the operator is concerned.
  return { kind: 'network' };
};

// Runs `attempt` until it succeeds or the policy stops. Every retry reuses the caller's
// Idempotency-Key, so a replayed submission returns the original 201 (ADR 0009).
export const runWithRetry = async <T>(
  attempt: () => Promise<T>,
  policy: Policy,
  runtime: RetryRuntime,
): Promise<T> => {
  const startedAt = runtime.clock();

  for (let attemptNumber = 1; ; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (err) {
      const decision = policy({
        attempt: attemptNumber,
        elapsedMs: runtime.clock() - startedAt,
        outcome: asOutcome(err),
      });

      if (!decision.retry) throw new RetryExhaustedError(decision.reason, attemptNumber, err);
      await runtime.sleep(decision.delayMs);
    }
  }
};

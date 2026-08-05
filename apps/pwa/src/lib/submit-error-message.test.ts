import { describe, expect, it } from 'vitest';
import { HttpAttemptError, RetryExhaustedError } from './retry-policy';
import { submitErrorMessage } from './submit-error-message';

describe('submitErrorMessage', () => {
  // AC-9.1.3. The operator has already retried for 15 minutes without knowing it, so the message
  // has to say the work is safe and that retrying is the next step.
  it('tells the operator their answers are kept when the retry window runs out', () => {
    const message = submitErrorMessage(new RetryExhaustedError('exhausted', 40, null));

    expect(message).toMatch(/still saved/i);
    expect(message).toMatch(/try again/i);
  });

  // A 409 or a 403 will not clear by waiting, so inviting the operator to retry wastes their time
  // and hides the real problem from whoever they report it to.
  it('does not invite a retry when retrying cannot help', () => {
    const message = submitErrorMessage(new RetryExhaustedError('not-retryable', 1, null));

    expect(message).not.toMatch(/try again/i);
    expect(message).toMatch(/supervisor/i);
  });

  it('falls back to a plain message for an unclassified failure', () => {
    expect(submitErrorMessage(new Error('boom'))).toMatch(/could not submit/i);
  });

  // DEV-143 code review: a 409 EQUIPMENT_OUT_OF_SERVICE or EQUIPMENT_RETIRED must not be flattened
  // into the same generic "report to your supervisor" copy as every other rejection, since the
  // operator already saw the lockout warning banner before submitting and deserves to know their
  // specific submission was the problem, not something unexplained.
  it('explains an EQUIPMENT_OUT_OF_SERVICE rejection specifically', () => {
    const cause = new HttpAttemptError(409, 'EQUIPMENT_OUT_OF_SERVICE');
    const message = submitErrorMessage(new RetryExhaustedError('not-retryable', 1, cause));

    expect(message).toMatch(/locked out/i);
    expect(message).toMatch(/still saved/i);
  });

  it('explains an EQUIPMENT_RETIRED rejection specifically', () => {
    const cause = new HttpAttemptError(409, 'EQUIPMENT_RETIRED');
    const message = submitErrorMessage(new RetryExhaustedError('not-retryable', 1, cause));

    expect(message).toMatch(/retired/i);
  });

  it('falls back to the generic rejection message for an unrecognized title', () => {
    const cause = new HttpAttemptError(409, 'IDEMPOTENCY_MISMATCH');
    const message = submitErrorMessage(new RetryExhaustedError('not-retryable', 1, cause));

    expect(message).toMatch(/supervisor/i);
    expect(message).not.toMatch(/locked out|retired/i);
  });

  // The title comes from a parsed response body; an intermediary's error page on a bad day could
  // hand back any JSON as the "problem" document. A plain-object lookup keyed on that value would
  // return an inherited Object.prototype member instead of undefined for a title like
  // "constructor", and the caller would try to render that as the message (code review on
  // DEV-143). Must fall back to the generic string, not throw or return a non-string.
  it('does not resolve a prototype-chain property for an adversarial title', () => {
    const cause = new HttpAttemptError(409, 'constructor');
    const message = submitErrorMessage(new RetryExhaustedError('not-retryable', 1, cause));

    expect(typeof message).toBe('string');
    expect(message).toMatch(/supervisor/i);
  });
});

import { describe, expect, it } from 'vitest';
import { RetryExhaustedError } from './retry-policy';
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
});

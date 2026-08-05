import { HttpAttemptError, RetryExhaustedError } from './retry-policy';

// Specific copy for the rejections an operator can act on immediately, keyed by the server's
// RFC 7807 title (app.ts's error handler sets it to the httpError code). Anything not listed
// here falls through to the generic "report to your supervisor" message below.
//
// A Map, not a plain object: `title` comes from a parsed response body (an intermediary's error
// page on a bad day could hand back anything as JSON), and a plain-object lookup for a title of
// "constructor" or "toString" would return an inherited Object.prototype function instead of
// undefined, which the caller would then try to render as the error message (code review on
// DEV-143).
const KNOWN_REJECTION_MESSAGES = new Map<string, string>([
  [
    'EQUIPMENT_OUT_OF_SERVICE',
    'This equipment is already locked out and your answers did not report another blocking problem, so nothing was submitted. Your answers are still saved. A supervisor must return it to service first.',
  ],
  [
    'EQUIPMENT_RETIRED',
    'This equipment has been retired and cannot be inspected. Your answers are still saved. Report this to your supervisor.',
  ],
]);

// What the operator is told when a submission does not land. The reported defect showed a blank
// checklist and no message at all (DEV-125); the rule here is that the operator always learns
// whether their work survived and whether retrying is worth doing.
export const submitErrorMessage = (err: unknown): string => {
  if (err instanceof RetryExhaustedError) {
    if (err.reason === 'exhausted') {
      return 'Could not reach the server. Your answers are still saved on this device. Try again when you have a signal.';
    }
    // Retrying a rejected request cannot change the answer, so the next step is a person, not
    // another tap. Covers a 409 idempotency mismatch and a 403 role or certification rejection,
    // and (DEV-143) a submission core-api rejected for equipment lockout, which gets specific
    // copy since it is the one rejection reason the operator can act on without a supervisor
    // first explaining what happened.
    if (err.cause instanceof HttpAttemptError && err.cause.title) {
      const specific = KNOWN_REJECTION_MESSAGES.get(err.cause.title);
      if (specific) return specific;
    }
    return 'The server rejected this inspection. Your answers are still saved. Report this to your supervisor before re-inspecting.';
  }

  return 'Could not submit the inspection. Your answers are still saved on this device.';
};

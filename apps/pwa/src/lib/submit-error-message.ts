import { RetryExhaustedError } from './retry-policy';

// What the operator is told when a submission does not land. The reported defect showed a blank
// checklist and no message at all (DEV-125); the rule here is that the operator always learns
// whether their work survived and whether retrying is worth doing.
export const submitErrorMessage = (err: unknown): string => {
  if (err instanceof RetryExhaustedError) {
    if (err.reason === 'exhausted') {
      return 'Could not reach the server. Your answers are still saved on this device. Try again when you have a signal.';
    }
    // Retrying a rejected request cannot change the answer, so the next step is a person, not
    // another tap. Covers a 409 idempotency mismatch and a 403 role or certification rejection.
    return 'The server rejected this inspection. Your answers are still saved. Report this to your supervisor before re-inspecting.';
  }

  return 'Could not submit the inspection. Your answers are still saved on this device.';
};

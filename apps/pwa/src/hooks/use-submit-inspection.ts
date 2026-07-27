import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMsal } from '@azure/msal-react';
import {
  inspectionSchema,
  type Inspection,
  type SubmitInspection,
} from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import {
  defaultRetryRuntime,
  HttpAttemptError,
  runWithRetry,
  submissionRetry,
} from '@/lib/retry-policy';

type SubmitArgs = {
  payload: SubmitInspection;
  // Reused across retries of the same logical submission so a retry replays the original 201
  // instead of creating a second inspection (core-api idempotency, ADR 0009). The caller keeps it
  // stable (a ref) for the lifetime of one submit screen.
  idempotencyKey: string;
};

// Submits an inspection to core-api (POST /api/v1/inspections). The server derives the result and
// seals the record into the audit chain; this only sends the operator's attested answers. On a
// non-2xx the promise rejects, so the calling screen can surface an error and let the operator
// retry with the same idempotency key.
export const useSubmitInspection = (): UseMutationResult<Inspection, Error, SubmitArgs> => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  return useMutation<Inspection, Error, SubmitArgs>({
    // A fresh submit changes the operator's history and the equipment's last-inspection/status, so
    // drop those caches; otherwise the just-submitted inspection is missing from the recent list
    // and /history until React Query's staleTime elapses.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-inspections'] });
      void queryClient.invalidateQueries({ queryKey: ['equipment'] });
    },
    // A short network drop must not end a completed inspection (ADR 0025, FRS 9.1). The POST is
    // retried on the 1s/2s/4s/8s schedule up to the 15-minute ceiling, reusing the caller's
    // Idempotency-Key so a replay returns the original 201 rather than creating a second
    // inspection (ADR 0009). The token is re-acquired per attempt: a drop long enough to matter
    // can outlive the access token.
    mutationFn: ({ payload, idempotencyKey }) =>
      runWithRetry(
        async () => {
          const accessToken = await acquireAccessToken(instance, accounts);

          const res = await fetch('/api/v1/inspections', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
          });

          if (!res.ok) throw new HttpAttemptError(res.status);

          return inspectionSchema.parse(await res.json());
        },
        submissionRetry,
        defaultRetryRuntime,
      ),
  });
};

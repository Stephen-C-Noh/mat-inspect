'use client';

import { createContext, useCallback, useContext, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityFeedSchema, type ActivityInspection } from '@mat-inspect/shared-schemas';
import { acquireAccessToken, acquireAccessTokenSilent } from '@/lib/auth';
import { ACTIVITY_POLL_INTERVAL_MS } from '@/lib/polling';
import { EQUIPMENT_QUERY_KEY } from '@/hooks/use-equipment';
import { DEFECTS_QUERY_KEY } from '@/hooks/use-defects';

export const ACTIVITY_QUERY_KEY = ['activity'] as const;

type ActivityContextValue = {
  // Inspections inside the feed's retention window that this manager has not dismissed, newest
  // first. Server-held, so it survives a reload and agrees across their devices.
  unread: ActivityInspection[];
  dismiss: (inspectionIds: string[]) => void;
  isDismissing: boolean;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

// Drives every live view on the dashboard from one polled request (ADR 0026). Before this, no
// query refetched on its own: a manager watching the Fleet page saw nothing until they reloaded
// (DEV-127, FRS AC 6.1.3). Polling every query instead would have re-read the whole fleet, the
// whole defect list and a machine's whole history every couple of seconds to learn that nothing
// happened, so the poll asks one cheap question and the rest of the dashboard reacts to the answer.
export const ActivityProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const { instance, accounts } = useMsal();
  const queryClient = useQueryClient();

  // Ids this provider has already reacted to. The feed repeats an undismissed inspection on every
  // poll by design, so "is anything here new" is answered against what was seen, not against a
  // cursor the server would have to advance.
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Two variants on purpose. The poll runs on a timer and takes the silent-only token, so an
  // expired session fails the poll instead of navigating the page out from under the manager. The
  // dismiss mutation is a click, so it may fall back to the interactive redirect like every other
  // request in the app.
  const pollFetch = useCallback(
    async (path: string): Promise<Response> => {
      const accessToken = await acquireAccessTokenSilent(instance, accounts);
      return fetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
    },
    [instance, accounts],
  );

  const clickFetch = useCallback(
    async (path: string, init: RequestInit): Promise<Response> => {
      const accessToken = await acquireAccessToken(instance, accounts);
      return fetch(path, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
      });
    },
    [instance, accounts],
  );

  const feed = useQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: async () => {
      const res = await pollFetch('/api/v1/activity');
      if (!res.ok) throw new Error(`Failed to fetch activity: ${res.status}`);

      const body = activityFeedSchema.parse(await res.json());

      // Reacting inside the query function keeps "what is new" and the record of having seen it in
      // one step. An effect would run per changed result, and two identical answers in a row are
      // the common case, so a repeat could be missed.
      const fresh = body.inspections.filter((item) => !seenIdsRef.current.has(item.id));
      if (fresh.length > 0) {
        for (const item of fresh) seenIdsRef.current.add(item.id);
        // The submit that produced these rows may also have changed a machine's status and raised
        // a blocking defect, so refresh all three views rather than guessing which moved.
        void queryClient.invalidateQueries({ queryKey: EQUIPMENT_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ['inspections'] });
      }

      return body;
    },
    enabled: accounts.length > 0,
    // Stop the timer once the session needs the user, rather than retrying every 2 seconds against
    // an expired token. The next thing the manager clicks takes the interactive path and signs
    // them back in; polling resumes with the remounted provider.
    refetchInterval: (query) =>
      query.state.error instanceof InteractionRequiredAuthError ? false : ACTIVITY_POLL_INTERVAL_MS,
    // The point of this query is to be re-asked, so a cached answer is never useful.
    staleTime: 0,
    // A failed poll is not worth reporting: the next one is two seconds away, and an error banner
    // over the whole dashboard because one background request lost a race would be noise.
    retry: false,
  });

  // An expired session means the panel's contents are unknowable, not empty. Showing a stale count
  // would tell a manager they are up to date when nobody is asking the server anything.
  const pollFailedForAuth = feed.error instanceof InteractionRequiredAuthError;

  const dismissal = useMutation({
    mutationFn: async (inspectionIds: string[]) => {
      const res = await clickFetch('/api/v1/activity/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionIds }),
      });
      if (!res.ok) throw new Error(`Failed to dismiss notifications: ${res.status}`);
    },
    // The server decides what is still undismissed, so re-read rather than editing a local copy.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACTIVITY_QUERY_KEY }),
  });

  const dismiss = useCallback(
    (inspectionIds: string[]) => {
      if (inspectionIds.length > 0) dismissal.mutate(inspectionIds);
    },
    [dismissal],
  );

  return (
    <ActivityContext.Provider
      value={{
        unread: pollFailedForAuth ? [] : (feed.data?.inspections ?? []),
        dismiss,
        isDismissing: dismissal.isPending,
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
};

export const useActivity = (): ActivityContextValue => {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity must be used inside ActivityProvider');
  return value;
};

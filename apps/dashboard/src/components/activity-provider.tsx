'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { activityFeedSchema, type ActivityInspection } from '@mat-inspect/shared-schemas';
import { acquireAccessToken } from '@/lib/auth';
import { ACTIVITY_POLL_INTERVAL_MS } from '@/lib/polling';
import { EQUIPMENT_QUERY_KEY } from '@/hooks/use-equipment';
import { DEFECTS_QUERY_KEY } from '@/hooks/use-defects';

export const ACTIVITY_QUERY_KEY = ['activity'] as const;

type ActivityContextValue = {
  // Inspections that arrived since this dashboard was opened and the manager has not dismissed.
  // Newest first.
  unread: ActivityInspection[];
  markAllRead: () => void;
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
  const [unread, setUnread] = useState<ActivityInspection[]>([]);

  // The cursor is the server's own clock, echoed back from the previous response, so a manager's
  // laptop running fast cannot skip an inspection submitted inside the difference. It lives in a
  // ref rather than state because advancing it must not re-render or change the query key: this
  // query is a repeating question, not a new question each time.
  const cursorRef = useRef<string | null>(null);

  useQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: async () => {
      const accessToken = await acquireAccessToken(instance, accounts);

      const since = cursorRef.current;
      const res = await fetch(
        `/api/v1/activity${since ? `?since=${encodeURIComponent(since)}` : ''}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!res.ok) throw new Error(`Failed to fetch activity: ${res.status}`);

      const feed = activityFeedSchema.parse(await res.json());
      cursorRef.current = feed.serverTime;

      // Reacting inside the query function rather than in an effect keeps the cursor advance and
      // the reaction to what it skipped past in one step. An effect would run per changed result,
      // and two quiet polls in a row produce the same result, so a burst could be missed.
      if (feed.inspections.length > 0) {
        setUnread((prev) => [...feed.inspections, ...prev]);
        // The submit that produced these rows may also have changed a machine's status and raised
        // a blocking defect, so refresh all three views rather than guessing which moved.
        void queryClient.invalidateQueries({ queryKey: EQUIPMENT_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: DEFECTS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ['inspections'] });
      }

      return feed;
    },
    enabled: accounts.length > 0,
    refetchInterval: ACTIVITY_POLL_INTERVAL_MS,
    // The point of this query is to be re-asked, so a cached answer is never useful.
    staleTime: 0,
    // A failed poll is not worth reporting: the next one is two seconds away, and an error banner
    // over the whole dashboard because one background request lost a race would be noise.
    retry: false,
  });

  const markAllRead = useCallback(() => setUnread([]), []);

  return (
    <ActivityContext.Provider value={{ unread, markAllRead }}>{children}</ActivityContext.Provider>
  );
};

export const useActivity = (): ActivityContextValue => {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity must be used inside ActivityProvider');
  return value;
};

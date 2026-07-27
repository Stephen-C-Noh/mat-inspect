// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { ActivityProvider, useActivity } from './activity-provider';
import { useEquipment } from '@/hooks/use-equipment';
import { useDefects } from '@/hooks/use-defects';
import { ACTIVITY_POLL_INTERVAL_MS } from '@/lib/polling';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const INSPECTION_ID = '44444444-4444-4444-4444-444444444444';

const acquireTokenSilent = vi.fn();
const acquireTokenRedirect = vi.fn();

// MSAL is the one dependency these hooks cannot run without and it is not this project's code
// (CLAUDE.md: mock external services only). Token acquisition, Zod parsing and the TanStack cache
// are all the real thing below this line.
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { acquireTokenSilent, acquireTokenRedirect, getActiveAccount: () => null },
    accounts: [
      {
        homeAccountId: 'home-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'tenant-id',
        localAccountId: 'local-id',
        username: 'sam.lee@example.edu',
        name: 'Sam Lee',
        idTokenClaims: { roles: ['manager'] },
      },
    ],
    inProgress: 'none',
  }),
}));

const equipmentRow = {
  id: EQUIPMENT_ID,
  assetTag: 'TD102',
  name: 'Overhead Crane TD102',
  type: 'OVERHEAD_CRANE',
  make: null,
  model: null,
  serialNumber: null,
  location: 'Main Bay',
  status: 'READY',
  currentStatusSince: '2026-07-26T21:13:00.000Z',
  manufacturerSpecsUrl: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-07-26T21:13:00.000Z',
  lastInspectionAt: '2026-07-26T21:13:00.000Z',
  lastInspectionResult: 'PASS',
  lastInspectionOperatorDisplayName: 'Jane Doe',
};

const undismissedInspection = {
  id: INSPECTION_ID,
  equipmentId: EQUIPMENT_ID,
  operatorId: '55555555-5555-5555-5555-555555555555',
  templateId: '22222222-2222-2222-2222-222222222222',
  templateVersion: 1,
  result: 'FAIL_BLOCKING',
  submittedAt: '2026-07-26T21:20:00.000Z',
  operatorDisplayName: 'Jane Doe',
  equipmentAssetTag: 'TD102',
  equipmentName: 'Overhead Crane TD102',
};

const json = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

// One extra poll is enough to prove the wiring in either direction.
const POLL_WAIT_MS = ACTIVITY_POLL_INTERVAL_MS + 2_000;

type Views = ReturnType<typeof useActivity> & {
  equipmentFetchedAt: number;
  defectsFetchedAt: number;
};

const renderViews = (): ReturnType<typeof renderHook<Views, void>> => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <ActivityProvider>{children}</ActivityProvider>
    </QueryClientProvider>
  );

  return renderHook(
    () => {
      const activity = useActivity();
      const equipment = useEquipment();
      const defects = useDefects();
      return {
        ...activity,
        equipmentFetchedAt: equipment.dataUpdatedAt,
        defectsFetchedAt: defects.dataUpdatedAt,
      };
    },
    { wrapper },
  );
};

let fetchMock: ReturnType<typeof vi.fn>;
let undismissed: unknown[];
let dismissBodies: string[][];

beforeEach(() => {
  undismissed = [];
  dismissBodies = [];
  acquireTokenSilent.mockReset().mockResolvedValue({ accessToken: 'test-token' });
  acquireTokenRedirect.mockReset().mockResolvedValue(undefined);

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/activity/dismiss') {
      const body = JSON.parse(String(init?.body)) as { inspectionIds: string[] };
      dismissBodies.push(body.inspectionIds);
      // The server decides what is left; model it by dropping the dismissed ids.
      undismissed = undismissed.filter(
        (item) => !body.inspectionIds.includes((item as { id: string }).id),
      );
      return { ok: true, status: 204, json: async () => ({}) } as Response;
    }
    if (url.startsWith('/api/v1/activity')) return json({ inspections: undismissed });
    if (url.startsWith('/api/v1/equipment')) return json([equipmentRow]);
    if (url.startsWith('/api/v1/defects')) return json([]);
    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const countFetches = (prefix: string): number =>
  fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(prefix)).length;

describe('activity-driven dashboard refresh', () => {
  // The reason this design exists. Polling every dashboard query would re-read the fleet, the
  // defect list and a machine's history every couple of seconds to learn that nothing happened.
  //
  // Asserted against the invalidations the provider issues rather than against fetch counts: the
  // fleet and defect queries carry a slow safety interval of their own, and counting their
  // requests would make this test a race between two timers under a loaded suite.
  it('invalidates nothing while nothing is undismissed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useActivity(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <ActivityProvider>{children}</ActivityProvider>
        </QueryClientProvider>
      ),
    });

    const polls = countFetches('/api/v1/activity');
    await waitFor(() => expect(countFetches('/api/v1/activity')).toBeGreaterThan(polls + 1), {
      timeout: POLL_WAIT_MS,
    });

    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.unread).toEqual([]);
  });

  // FRS AC 6.1.3: a submission has to appear without user interaction. A submit can also change
  // the machine's status and raise a blocking defect, so all three views are refreshed.
  it('refetches the fleet and the defect list when an inspection appears', async () => {
    const { result } = renderViews();

    await waitFor(() => expect(result.current.equipmentFetchedAt).toBeGreaterThan(0));
    const equipmentReads = countFetches('/api/v1/equipment');
    const defectReads = countFetches('/api/v1/defects');

    undismissed = [undismissedInspection];

    await waitFor(() => expect(countFetches('/api/v1/equipment')).toBeGreaterThan(equipmentReads), {
      timeout: POLL_WAIT_MS,
    });
    await waitFor(() => expect(countFetches('/api/v1/defects')).toBeGreaterThan(defectReads), {
      timeout: POLL_WAIT_MS,
    });
  });

  // The feed repeats an undismissed inspection on every poll, which is what makes the cursor
  // unnecessary. It must not be mistaken for a new arrival each time.
  it('reacts once to an inspection the feed keeps repeating', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useActivity(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <ActivityProvider>{children}</ActivityProvider>
        </QueryClientProvider>
      ),
    });
    undismissed = [undismissedInspection];

    await waitFor(() => expect(result.current.unread).toHaveLength(1), { timeout: POLL_WAIT_MS });
    const invalidations = invalidate.mock.calls.length;
    const polls = countFetches('/api/v1/activity');

    await waitFor(() => expect(countFetches('/api/v1/activity')).toBeGreaterThan(polls + 1), {
      timeout: POLL_WAIT_MS,
    });

    expect(invalidate.mock.calls.length).toBe(invalidations);
    expect(result.current.unread).toHaveLength(1);
  });

  // Dismissal is server-side (ADR 0026), so what the bell shows is whatever the server still
  // reports as undismissed, not a list the client edits.
  it('dismisses through the server and drops the entry once the feed agrees', async () => {
    const { result } = renderViews();
    undismissed = [undismissedInspection];

    await waitFor(() => expect(result.current.unread).toHaveLength(1), { timeout: POLL_WAIT_MS });
    expect(result.current.unread[0]!.equipmentAssetTag).toBe('TD102');

    result.current.dismiss([INSPECTION_ID]);

    await waitFor(() => expect(dismissBodies).toEqual([[INSPECTION_ID]]));
    await waitFor(() => expect(result.current.unread).toEqual([]), { timeout: POLL_WAIT_MS });
  });

  // The poll runs on a timer, so it must never start MSAL's interactive redirect: it would
  // navigate the page with no user action, and the next tick would fire again before navigation
  // commits, leaving MSAL wedged on interaction_in_progress.
  it('never starts an interactive redirect from the background poll', async () => {
    const { InteractionRequiredAuthError } = await import('@azure/msal-browser');
    acquireTokenSilent.mockRejectedValue(
      new InteractionRequiredAuthError('interaction_required', 'session expired'),
    );

    // Provider only. The fleet and defect queries take the interactive path on their initial load
    // by design (a manager opening the dashboard on an expired session should be signed back in),
    // so mounting them here would attribute their redirect to the poll.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useActivity(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <ActivityProvider>{children}</ActivityProvider>
        </QueryClientProvider>
      ),
    });

    await waitFor(() => expect(acquireTokenSilent).toHaveBeenCalled());
    // Give the timer room to fire again before concluding it stopped.
    await new Promise((resolve) => setTimeout(resolve, POLL_WAIT_MS));

    expect(acquireTokenRedirect).not.toHaveBeenCalled();
    expect(result.current.unread).toEqual([]);
  });
});

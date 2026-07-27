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

// MSAL is the one dependency these hooks cannot run without and it is not this project's code
// (CLAUDE.md: mock external services only). Token acquisition, Zod parsing and the TanStack cache
// are all the real thing below this line.
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: {
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
      getActiveAccount: () => null,
    },
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

const newInspection = {
  id: '44444444-4444-4444-4444-444444444444',
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

let activityCalls: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let feedQueue: unknown[];

beforeEach(() => {
  activityCalls = [];
  // Every poll after the queue is drained is quiet. serverTime advances so the cursor moves.
  feedQueue = [];

  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/activity')) {
      activityCalls.push(url);
      const queued = feedQueue.shift();
      return json(
        queued ?? {
          serverTime: new Date(2026, 6, 26, 21, 13, activityCalls.length).toISOString(),
          inspections: [],
        },
      );
    }
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
  // The first poll establishes the cursor. Asking for history on it would announce every
  // inspection already submitted today as new the moment a manager opens the dashboard.
  it('sends no since on the first poll and picks up the server clock for the next one', async () => {
    renderViews();

    await waitFor(() => expect(activityCalls.length).toBeGreaterThan(1), { timeout: POLL_WAIT_MS });
    expect(activityCalls[0]).toBe('/api/v1/activity');
    expect(activityCalls[1]).toContain('since=');
  });

  // The reason this design exists. Polling every dashboard query would re-read the fleet, the
  // defect list and a machine's history every couple of seconds to learn that nothing happened.
  it('does not refetch the fleet or the defect list while the feed is quiet', async () => {
    const { result } = renderViews();

    await waitFor(() => expect(result.current.equipmentFetchedAt).toBeGreaterThan(0));
    const equipmentReads = countFetches('/api/v1/equipment');
    const defectReads = countFetches('/api/v1/defects');

    await waitFor(() => expect(activityCalls.length).toBeGreaterThan(2), { timeout: POLL_WAIT_MS });

    expect(countFetches('/api/v1/equipment')).toBe(equipmentReads);
    expect(countFetches('/api/v1/defects')).toBe(defectReads);
    expect(result.current.unread).toEqual([]);
  });

  // FRS AC 6.1.3: a submission has to appear without user interaction. A submit can also change
  // the machine's status and raise a blocking defect, so all three views are refreshed.
  it('refetches the fleet and the defect list when the feed reports an inspection', async () => {
    const { result } = renderViews();

    await waitFor(() => expect(result.current.equipmentFetchedAt).toBeGreaterThan(0));
    const equipmentReads = countFetches('/api/v1/equipment');
    const defectReads = countFetches('/api/v1/defects');

    feedQueue.push({
      serverTime: '2026-07-26T21:20:01.000Z',
      inspections: [newInspection],
    });

    await waitFor(() => expect(countFetches('/api/v1/equipment')).toBeGreaterThan(equipmentReads), {
      timeout: POLL_WAIT_MS,
    });
    expect(countFetches('/api/v1/defects')).toBeGreaterThan(defectReads);
  });

  // What the bell shows. Newest first, and it survives later quiet polls: a manager who steps away
  // must still find what they missed when they come back.
  it('collects reported inspections as unread until the manager clears them', async () => {
    const { result } = renderViews();

    feedQueue.push({
      serverTime: '2026-07-26T21:20:01.000Z',
      inspections: [newInspection],
    });

    await waitFor(() => expect(result.current.unread).toHaveLength(1), { timeout: POLL_WAIT_MS });
    expect(result.current.unread[0]!.equipmentAssetTag).toBe('TD102');

    // Two more quiet polls must not drop it.
    const seen = activityCalls.length;
    await waitFor(() => expect(activityCalls.length).toBeGreaterThan(seen + 1), {
      timeout: POLL_WAIT_MS,
    });
    expect(result.current.unread).toHaveLength(1);

    result.current.markAllRead();
    await waitFor(() => expect(result.current.unread).toEqual([]));
  });
});

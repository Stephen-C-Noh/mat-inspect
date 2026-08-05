// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import LockoutPage from './page';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push, replace, back: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }) },
    accounts: [
      {
        homeAccountId: 'home-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'tenant-id',
        localAccountId: 'local-id',
        username: 'jane.doe@example.edu',
        name: 'Jane Doe',
        idTokenClaims: { roles: ['operator'] },
      },
    ],
    inProgress: 'none',
  }),
}));

let equipmentStatus: 'OUT_OF_SERVICE' | 'RETIRED' | 'READY' | 'AWAITING_INSPECTION' =
  'OUT_OF_SERVICE';
let equipmentFetchFails = false;

const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('/api/v1/equipment')) {
    if (equipmentFetchFails) return { ok: false, status: 503, json: async () => ({}) } as Response;
    const equipment = {
      id: EQUIPMENT_ID,
      assetTag: 'FL-001',
      name: 'Forklift 1',
      type: 'FORKLIFT',
      make: null,
      model: null,
      serialNumber: null,
      location: null,
      status: equipmentStatus,
      currentStatusSince: '2026-07-27T12:00:00.000Z',
      manufacturerSpecsUrl: null,
      createdAt: '2026-07-27T12:00:00.000Z',
      updatedAt: '2026-07-27T12:00:00.000Z',
    };
    return { ok: true, status: 200, json: async () => equipment } as Response;
  }
  throw new Error(`unexpected request: ${url}`);
});

const renderLockout = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<LockoutPage />, { wrapper });
};

beforeEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
  fetchMock.mockClear();
  searchParams = new URLSearchParams();
  equipmentStatus = 'OUT_OF_SERVICE';
  equipmentFetchFails = false;
  vi.stubGlobal('fetch', fetchMock);
});

// DEV-143 code review: this screen has a hard back-button trap by design (so a fresh FAIL_BLOCKING
// submit cannot be backed into and resubmitted), but had no forward path at all. It is now also
// reached by browsing directly to locked-out or retired equipment, not only right after a failing
// submit, so the trap alone would strand an operator with no way off the screen.
describe('lockout screen escape hatch', () => {
  it('has a button that navigates to the equipment list', async () => {
    renderLockout();

    await userEvent.click(await screen.findByRole('button', { name: /back to equipment list/i }));

    expect(push).toHaveBeenCalledWith('/');
  });
});

// DEV-143 code review: whether this screen shows FAIL_BLOCKING copy or RETIRED copy must come
// from the fetched equipment row (the server), not from a `?reason=` query param anyone could
// paste onto the URL — this screen's own stated rule for equipmentName/assetTag above, now
// applied to which copy renders at all.
describe('lockout screen copy source', () => {
  it('shows the failed-inspection defects and return-to-service copy for OUT_OF_SERVICE equipment', async () => {
    equipmentStatus = 'OUT_OF_SERVICE';
    searchParams = new URLSearchParams({
      defect: 'Forks cracked',
      lockedAt: '2026-08-04T12:00:00Z',
    });
    renderLockout();

    expect(await screen.findByText('Forks cracked')).not.toBeNull();
    expect(screen.getByText(/return-to-service/i)).not.toBeNull();
  });

  it('does not fabricate a defect or return-to-service instruction for RETIRED equipment', async () => {
    equipmentStatus = 'RETIRED';
    renderLockout();

    await screen.findByText(/permanently retired/i);
    expect(screen.queryByText('Critical safety compliance violation')).toBeNull();
    expect(screen.queryByText('Critical Defects Found')).toBeNull();
    // The retired copy correctly says no RTS cycle applies; it must not carry the default
    // footer's actionable "a supervisor must resolve the defect and approve return-to-service"
    // instruction, which is only true for a lockout, not a retirement.
    expect(screen.queryByText(/must resolve the defect/i)).toBeNull();
  });

  it('ignores a spoofed ?reason=retired on merely-OUT_OF_SERVICE equipment and still shows its real defect', async () => {
    equipmentStatus = 'OUT_OF_SERVICE';
    searchParams = new URLSearchParams({ reason: 'retired', defect: 'Forks cracked' });
    renderLockout();

    expect(await screen.findByText('Forks cracked')).not.toBeNull();
    expect(screen.queryByText(/permanently retired/i)).toBeNull();
  });

  it('shows the retired copy for RETIRED equipment reached with no ?reason= param at all', async () => {
    equipmentStatus = 'RETIRED';
    searchParams = new URLSearchParams();
    renderLockout();

    await screen.findByText(/permanently retired/i);
    expect(screen.queryByText('Critical safety compliance violation')).toBeNull();
  });

  // The copy branch has three states, not two: an unloadable status must not fall through to the
  // lockout copy, which would put the fabricated defect and the return-to-service instruction back
  // on the screen for a retired unit whenever the equipment read fails (code review on DEV-143).
  it('states no reason when the equipment status cannot be loaded', async () => {
    equipmentFetchFails = true;
    renderLockout();

    await screen.findByText(/could not be confirmed/i);
    expect(screen.queryByText('Critical safety compliance violation')).toBeNull();
    expect(screen.queryByText('Critical Defects Found')).toBeNull();
    expect(screen.queryByText(/must resolve the defect/i)).toBeNull();
    expect(screen.queryByText(/permanently retired/i)).toBeNull();
    // The screen is a lockout tag: an unknown status still reads as do-not-operate.
    expect(screen.getByText(/do not operate/i)).not.toBeNull();
  });

  // Copilot review on PR #132: a loaded status that is neither lockout state (a supervisor
  // completed return-to-service between the failing submit and this screen loading, or this URL
  // is a stale bookmark) was falling into the same 'unknown' bucket as a pending/failed read and
  // showing "Do Not Operate" for equipment the server says is available. Redirects away instead,
  // and must not engage the popstate trap while doing so.
  it.each(['READY', 'AWAITING_INSPECTION'] as const)(
    'redirects away instead of showing a lockout tag for %s equipment',
    async (status) => {
      equipmentStatus = status;
      searchParams = new URLSearchParams({ defect: 'Forks cracked' });
      renderLockout();

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
      expect(screen.queryByText('Do Not Operate')).toBeNull();
      expect(screen.queryByText('Forks cracked')).toBeNull();
    },
  );
});

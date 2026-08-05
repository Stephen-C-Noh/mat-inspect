// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import LockoutPage from './page';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
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

const equipment = {
  id: EQUIPMENT_ID,
  assetTag: 'FL-001',
  name: 'Forklift 1',
  type: 'FORKLIFT',
  status: 'OUT_OF_SERVICE',
};

const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('/api/v1/equipment')) {
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
  fetchMock.mockClear();
  searchParams = new URLSearchParams();
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

describe('lockout screen reason-specific copy', () => {
  it('shows the failed-inspection defects and return-to-service copy by default', async () => {
    searchParams = new URLSearchParams({
      defect: 'Forks cracked',
      lockedAt: '2026-08-04T12:00:00Z',
    });
    renderLockout();

    expect(await screen.findByText('Forks cracked')).not.toBeNull();
    expect(screen.getByText(/return-to-service/i)).not.toBeNull();
  });

  it('does not fabricate a defect or return-to-service instruction for retired equipment', async () => {
    searchParams = new URLSearchParams({ reason: 'retired' });
    renderLockout();

    await screen.findByText(/permanently retired/i);
    expect(screen.queryByText('Critical safety compliance violation')).toBeNull();
    expect(screen.queryByText('Critical Defects Found')).toBeNull();
    // The retired copy correctly says no RTS cycle applies; it must not carry the default
    // footer's actionable "a supervisor must resolve the defect and approve return-to-service"
    // instruction, which is only true for a lockout, not a retirement.
    expect(screen.queryByText(/must resolve the defect/i)).toBeNull();
  });
});

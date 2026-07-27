// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { InspectionDraftProvider } from '@/components/inspection-draft-provider';
import ChecklistPage from './page';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '55555555-5555-5555-5555-555555555555';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/inspect/${EQUIPMENT_ID}`,
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
  useIsAuthenticated: () => true,
}));

const equipment = {
  id: EQUIPMENT_ID,
  assetTag: 'FL-001',
  name: 'Forklift 1',
  type: 'FORKLIFT',
  make: null,
  model: null,
  serialNumber: null,
  location: null,
  status: 'READY',
  currentStatusSince: '2026-07-27T12:00:00.000Z',
  manufacturerSpecsUrl: null,
  createdAt: '2026-07-27T12:00:00.000Z',
  updatedAt: '2026-07-27T12:00:00.000Z',
};

const template = {
  id: TEMPLATE_ID,
  equipmentType: 'FORKLIFT',
  version: 1,
  isActive: true,
  effectiveFrom: '2026-07-27T12:00:00.000Z',
  items: [
    {
      key: 'forks',
      prompt: 'Forks intact?',
      type: 'BOOLEAN',
      required: true,
      failSeverity: 'BLOCKING',
    },
  ],
  createdBy: USER_ID,
  reviewedBy: null,
  createdAt: '2026-07-27T12:00:00.000Z',
};

const jsonOk = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

// Serves the two reads the screen needs and nothing else, so any POST shows up as an unmatched
// call rather than being quietly satisfied.
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('/api/v1/equipment')) return jsonOk([equipment]);
  if (url.startsWith('/api/v1/checklists/active')) return jsonOk(template);
  throw new Error(`unexpected request: ${url}`);
});

const renderChecklist = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <InspectionDraftProvider>{children}</InspectionDraftProvider>
    </QueryClientProvider>
  );
  return render(<ChecklistPage />, { wrapper });
};

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  push.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('checklist screen submit action', () => {
  // The defect (D-003, DEV-126): pressing submit on an all-pass checklist POSTed straight away,
  // so the record carried an attestation the operator never made. The action now has to hand off
  // to the review screen instead of recording anything.
  it('sends the operator to the review screen instead of POSTing the inspection', async () => {
    renderChecklist();

    const pass = await screen.findByRole('button', { name: /pass/i });
    await userEvent.click(pass);

    await userEvent.click(screen.getByRole('button', { name: /submit inspection/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/checklist/${EQUIPMENT_ID}/review`));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inspections')).toHaveLength(0);
  });
});

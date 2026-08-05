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
const back = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push, back, replace }),
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
  back.mockClear();
  replace.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('checklist screen header', () => {
  // DEV-116: an installed (standalone) PWA has no browser back chrome, so an operator who scanned
  // the wrong equipment had no way off this screen.
  it('has a back button that navigates back', async () => {
    renderChecklist();

    await userEvent.click(await screen.findByRole('button', { name: /go back/i }));

    expect(back).toHaveBeenCalledTimes(1);
  });
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

  // ADR 0009: the review screen mints the idempotency key on the first confirm. If backing out to
  // this screen dropped it, the retry after a timed-out POST would mint a new one and record a
  // second inspection instead of replaying the original 201.
  it('preserves the submit idempotency key already in the draft', async () => {
    window.sessionStorage.setItem(
      'mat-inspect.inspection-draft',
      JSON.stringify({
        savedAt: new Date().toISOString(),
        draft: {
          equipmentId: EQUIPMENT_ID,
          templateId: TEMPLATE_ID,
          items: template.items,
          answers: { forks: { kind: 'BOOLEAN', passed: true } },
          notes: {},
          photoIds: {},
          submitIdempotencyKey: '99999999-9999-9999-9999-999999999999',
        },
      }),
    );

    renderChecklist();
    await screen.findByRole('button', { name: /pass/i });

    await waitFor(() =>
      expect(
        JSON.parse(window.sessionStorage.getItem('mat-inspect.inspection-draft') as string).draft
          .submitIdempotencyKey,
      ).toBe('99999999-9999-9999-9999-999999999999'),
    );
  });

  // The one thing stopping a note written against a fail from being sealed onto a PASS row
  // (ADR 0008): buildSubmitPayload deliberately does no pass/fail filtering of its own and says so,
  // so this reset is the whole guarantee. It had no test.
  it('clears a note written against a fail when the operator re-marks the item as passing', async () => {
    renderChecklist();

    await userEvent.click(await screen.findByRole('button', { name: /fail/i }));
    await userEvent.type(screen.getByPlaceholderText(/describe the defect/i), 'left fork cracked');

    const storedNote = (): unknown =>
      JSON.parse(window.sessionStorage.getItem('mat-inspect.inspection-draft') as string).draft
        .notes.forks?.notes;

    await waitFor(() => expect(storedNote()).toBe('left fork cracked'));

    await userEvent.click(screen.getByRole('button', { name: /pass/i }));

    await waitFor(() => expect(storedNote()).toBe(''));
  });

  // The submit action itself no longer writes the draft: persisting on every answer (DEV-125) has
  // already done it. This pins that invariant, because the review screen reads the draft on mount
  // and would show a blank summary if the answer had not reached storage on its own.
  it('has already persisted the answers to storage by the time it hands off to review', async () => {
    renderChecklist();

    const pass = await screen.findByRole('button', { name: /pass/i });
    await userEvent.click(pass);

    await userEvent.click(screen.getByRole('button', { name: /submit inspection/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/checklist/${EQUIPMENT_ID}/review`));

    const raw = window.sessionStorage.getItem('mat-inspect.inspection-draft');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).draft).toMatchObject({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
    });
  });
});

// DEV-143: RETIRED equipment never gets a checklist (no repair-and-return-to-service cycle
// applies to it, and core-api rejects every submit). OUT_OF_SERVICE is different: an operator can
// legitimately reopen the checklist and find another blocking problem during the same lockout
// (DEV-101 lockout-cycle test on the backend), so it gets a warning banner instead of a redirect.
describe('checklist screen lockout gate', () => {
  const stubEquipmentFetch = (status: string): void => {
    const stubbed = { ...equipment, status };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/v1/equipment')) return jsonOk([stubbed]);
        if (url.startsWith('/api/v1/checklists/active')) return jsonOk(template);
        throw new Error(`unexpected request: ${url}`);
      }),
    );
  };

  it('redirects to the lockout screen instead of rendering the checklist for RETIRED equipment', async () => {
    stubEquipmentFetch('RETIRED');

    renderChecklist();

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/lockout/${EQUIPMENT_ID}`));
    expect(screen.queryByRole('button', { name: /submit inspection/i })).toBeNull();
  });

  it('shows a warning banner but still renders the checklist for OUT_OF_SERVICE equipment', async () => {
    stubEquipmentFetch('OUT_OF_SERVICE');

    renderChecklist();

    await screen.findByRole('alert');
    expect(replace).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /pass/i })).not.toBeNull();
  });
});

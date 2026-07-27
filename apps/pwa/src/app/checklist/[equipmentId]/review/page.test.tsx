// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import { InspectionDraftProvider } from '@/components/inspection-draft-provider';
import { loadDraft, saveDraft } from '@/lib/inspection-draft-storage';
import ReviewPage from './page';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';

const push = vi.fn();
const replace = vi.fn();

// Next's router and MSAL are the two things a page cannot run without and neither belongs to this
// project's code, so they are stubbed at the module boundary (CLAUDE.md: mock external services
// only). Everything below the page (draft storage, summary, payload builder) is the real thing.
vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push, back: vi.fn(), replace }),
  usePathname: () => `/checklist/${EQUIPMENT_ID}/review`,
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

const forks: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

const horn: ChecklistItem = {
  key: 'horn',
  prompt: 'Horn sounds?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'WARNING',
};

const remarks: ChecklistItem = {
  key: 'remarks',
  prompt: 'Additional remarks',
  type: 'TEXT',
  required: false,
  failSeverity: 'WARNING',
};

const seedDraft = (overrides: Partial<Parameters<typeof saveDraft>[1]> = {}): void => {
  saveDraft(
    window.sessionStorage,
    {
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [forks, horn, remarks],
      answers: {
        forks: { kind: 'BOOLEAN', passed: true },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      inlineNotes: {},
      failureDocs: {},
      ...overrides,
    },
    new Date(),
  );
};

const renderReview = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <InspectionDraftProvider>{children}</InspectionDraftProvider>
    </QueryClientProvider>
  );
  return render(<ReviewPage />, { wrapper });
};

const INSPECTION_ID = '44444444-4444-4444-4444-444444444444';

const okInspection = (result: string): Response =>
  ({
    ok: true,
    status: 201,
    json: async () => ({
      id: INSPECTION_ID,
      equipmentId: EQUIPMENT_ID,
      operatorId: '55555555-5555-5555-5555-555555555555',
      templateId: TEMPLATE_ID,
      templateVersion: 1,
      result,
      submittedAt: '2026-07-27T15:00:00.000Z',
    }),
  }) as Response;

// Testing Library only auto-cleans when vitest runs with globals enabled, which this repo does
// not. Unmount explicitly so one test's DOM is not visible to the next.
beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  push.mockClear();
  replace.mockClear();
  vi.unstubAllGlobals();
});

describe('review and confirm screen', () => {
  // ADR 0007 names exactly what the operator has to see before attesting: how many items they
  // answered, how many failed, and who the record will be filed under.
  it('shows the answered count, the failed count and the operator name from the token', () => {
    seedDraft();
    renderReview();

    const summary = screen.getByRole('status', { name: /attestation summary/i });
    expect(summary.textContent).toContain('3 of 3');
    expect(summary.textContent).toContain('0 failed');
    expect(summary.textContent).toContain('Jane Doe');
  });

  // The load-bearing control of ADR 0007, and the reason the project could drop the per-record
  // HMAC: the record is only created by a deliberate human act taken after the review. Rendering
  // the summary must not be enough.
  it('does not POST the inspection until the operator confirms', async () => {
    seedDraft();
    const fetchMock = vi.fn().mockResolvedValue(okInspection('PASS'));
    vi.stubGlobal('fetch', fetchMock);

    renderReview();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/inspections');
    expect(JSON.parse(init.body as string).attested).toBe(true);
  });

  // One review surface serves both submit paths, so the screen has to send the operator to the
  // right confirmation afterwards. The count comes from the answers, not from which screen the
  // operator arrived from.
  it('reports the failures and lands on the fail confirmation when an item failed', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      failureDocs: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          photoIds: ['33333333-3333-3333-3333-333333333333'],
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okInspection('FAIL_BLOCKING')));

    renderReview();
    expect(screen.getByRole('status', { name: /attestation summary/i }).textContent).toContain(
      '1 failed',
    );

    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/checklist/${EQUIPMENT_ID}/submitted/fail`),
    );
  });

  // ADR 0007 calls this step "a deliberate safety check before commit". Counts alone are not
  // reviewable: the operator has to see which item failed and what they recorded against it,
  // which is also the last chance to catch a defect note attached to the wrong item.
  it('lists each failed item with its defect note and evidence photo count', () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      failureDocs: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          photoIds: ['33333333-3333-3333-3333-333333333333'],
        },
      },
    });
    renderReview();

    const failures = screen.getByRole('list', { name: /failed items/i });
    expect(failures.textContent).toContain('Forks intact?');
    expect(failures.textContent).toContain('left fork cracked at the heel');
    expect(failures.textContent).toContain('1 evidence photo');
    // A passing item is not a failure and must not appear in this list.
    expect(failures.textContent).not.toContain('Horn sounds?');
  });

  // Declining to confirm is a real outcome, not a dead end: the operator goes back to fix an
  // answer. Nothing may be recorded, and the walkaround they already did must survive.
  it('backs out to the checklist with the answers intact and nothing submitted', async () => {
    seedDraft();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderReview();
    await userEvent.click(screen.getByRole('button', { name: /back to checklist/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/inspect/${EQUIPMENT_ID}`);
    expect(loadDraft(window.sessionStorage, EQUIPMENT_ID, new Date())?.answers).toEqual({
      forks: { kind: 'BOOLEAN', passed: true },
      horn: { kind: 'BOOLEAN', passed: true },
      remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
    });
  });

  // Reachable with the browser's back gesture after a confirm cleared the draft, and after the
  // lab-local day rolls over, which makes loadDraft discard the previous day's work. An empty
  // attestation screen with no header and no navigation is a dead end.
  it('sends the operator back to the checklist when no draft is in progress', async () => {
    renderReview();

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/inspect/${EQUIPMENT_ID}`));
    expect(screen.queryByRole('button', { name: /confirm and submit/i })).toBeNull();
  });

  // "Back to Checklist" pushes rather than pops, so an operator can leave this screen, fail an
  // item (which the checklist persists immediately) and return with the back gesture, remounting
  // the screen against a draft whose failure was never documented. Attesting there would record a
  // FAIL_BLOCKING with no defect note and no evidence photo, past the failure screen's own gate.
  it('sends the operator to the failure screen when a failed item has no evidence photo', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      failureDocs: {},
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderReview();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/checklist/${EQUIPMENT_ID}/failures`),
    );
    expect(screen.queryByRole('button', { name: /confirm and submit/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The key outlives this screen so the recovery path the screen itself offers (the error sits
  // directly above "Back to Checklist") cannot turn a POST that reached core-api into a second
  // inspection for the same walkaround (ADR 0009).
  it('persists the idempotency key into the draft so a retry replays the original submit', async () => {
    seedDraft();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    renderReview();
    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const stored = loadDraft(window.sessionStorage, EQUIPMENT_ID, new Date());
    expect(stored?.submitIdempotencyKey).toBe(sent['Idempotency-Key']);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import {
  InspectionDraftProvider,
  useInspectionDraft,
} from '@/components/inspection-draft-provider';
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

// BOOLEAN_PHOTO_ON_FAIL: the type that requires evidence on a fail (DEV-120). horn stays plain
// BOOLEAN so tests can tell "no evidence required" apart from "evidence required and missing".
const forks: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN_PHOTO_ON_FAIL',
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
      notes: {},
      photoIds: {},
      categories: {},
      ...overrides,
    },
    new Date(),
  );
};

// Reads the result the provider hands to the confirmation screens, so a test can observe what
// review/page.tsx actually put there without reaching into its internals.
const ResultPhotoIdProbe = (): ReactElement => {
  const { result } = useInspectionDraft();
  return <div data-testid="probe-photo-id">{result?.failures[0]?.photoId ?? 'none'}</div>;
};

const renderReview = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <InspectionDraftProvider>
        {children}
        <ResultPhotoIdProbe />
      </InspectionDraftProvider>
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
  // operator arrived from. The server's result decides the destination, not the client's own
  // failSeverity guess: a WARNING-only failure still lands on the generic fail confirmation.
  it('reports the failures and lands on the fail confirmation when the result is FAIL_WARNING', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: true },
        horn: { kind: 'BOOLEAN', passed: false },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {
        horn: {
          notes: 'horn is faint but audible',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { horn: ['33333333-3333-3333-3333-333333333333'] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okInspection('FAIL_WARNING')));

    renderReview();
    expect(screen.getByRole('status', { name: /attestation summary/i }).textContent).toContain(
      '1 failed',
    );

    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/checklist/${EQUIPMENT_ID}/submitted/fail`),
    );
  });

  // DEV-132: a FAIL_BLOCKING result must reach the lockout tag screen (DEV-22), not the generic
  // fail confirmation. The blocking defects and the server's submittedAt travel as query params
  // since there is no endpoint to fetch them after the fact (lockout page's own comment).
  it('lands on the lockout screen with the blocking defects when the result is FAIL_BLOCKING', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { forks: ['33333333-3333-3333-3333-333333333333'] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okInspection('FAIL_BLOCKING')));

    renderReview();
    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const [destination] = push.mock.calls[0] as [string];
    expect(destination.startsWith(`/lockout/${EQUIPMENT_ID}?`)).toBe(true);
    const url = new URL(destination, 'http://localhost');
    expect(url.searchParams.getAll('defect')).toEqual([
      'Forks intact?: left fork cracked at the heel',
    ]);
    expect(url.searchParams.get('lockedAt')).toBe('2026-07-27T15:00:00.000Z');
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
      notes: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { forks: ['33333333-3333-3333-3333-333333333333'] },
    });
    renderReview();

    const failures = screen.getByRole('list', { name: /failed items/i });
    expect(failures.textContent).toContain('Forks intact?');
    expect(failures.textContent).toContain('left fork cracked at the heel');
    expect(failures.textContent).toContain('1 evidence photo');
    // A passing item is not a failure and must not appear in this list.
    expect(failures.textContent).not.toContain('Horn sounds?');
  });

  // DEV-131: the confirmation screen fetches the evidence photo Media-direct by id, which only
  // works if the submission result carries the real id instead of a hardcoded null.
  it("carries the failed item's photo id into the submission result", async () => {
    const PHOTO_ID = '33333333-3333-3333-3333-333333333333';
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { forks: [PHOTO_ID] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okInspection('FAIL_BLOCKING')));

    renderReview();
    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() => expect(screen.getByTestId('probe-photo-id').textContent).toBe(PHOTO_ID));
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
  // FAIL_BLOCKING with no defect note and no evidence photo, past the checklist screen's own gate.
  it('sends the operator back to the checklist when a photo-required item has no evidence photo', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {},
      photoIds: {},
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderReview();

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/inspect/${EQUIPMENT_ID}`));
    expect(screen.queryByRole('button', { name: /confirm and submit/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A plain BOOLEAN fail (not BOOLEAN_PHOTO_ON_FAIL) never requires evidence (DEV-120): the review
  // screen must not block on it just because horn's answer flipped to fail with no note or photo.
  it('does not gate on a plain boolean fail that has no evidence photo', () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: true },
        horn: { kind: 'BOOLEAN', passed: false },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {},
      photoIds: {},
    });

    renderReview();

    expect(screen.getByRole('button', { name: /confirm and submit/i })).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
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

  // Regression (ADR 0028 + ADR 0009): this screen mutates two draft fields, the confirmed
  // categories and the idempotency key, and saveDraft REPLACES the record. A category change after
  // a failed submit must not drop the key. It used to: the category effect saved a stale draft that
  // erased the freshly minted key, so a reload minted a second key and a retried submit recorded a
  // duplicate (immutable) inspection.
  it('keeps the idempotency key when a category changes after a failed submit', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { forks: ['33333333-3333-3333-3333-333333333333'] },
    });
    // Both the category suggestion and the submit hit the network and fail: the suggestion is then
    // unavailable (so the operator adds a category by hand) and the submit rejects (so a retry has
    // to replay the original key).
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    renderReview();

    await userEvent.click(screen.getByRole('button', { name: /confirm and submit/i }));
    await waitFor(() =>
      expect(
        loadDraft(window.sessionStorage, EQUIPMENT_ID, new Date())?.submitIdempotencyKey,
      ).toBeTruthy(),
    );
    const key = loadDraft(window.sessionStorage, EQUIPMENT_ID, new Date())!.submitIdempotencyKey;

    // The operator now records a failure-mode category on the failed item.
    await userEvent.click(screen.getByRole('button', { name: /add category/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Leak' }));

    const stored = loadDraft(window.sessionStorage, EQUIPMENT_ID, new Date());
    expect(stored?.submitIdempotencyKey).toBe(key);
    expect(stored?.categories.forks?.confirmed).toBe('LEAK');
  });

  // Regression (ADR 0028): an abstained suggestion (category: null, status: OK) left suggested
  // and confirmed both undefined, which looked identical to "never asked" and fired another
  // /ai/categorize call on every remount, spending the shared mini-PC inference budget (ADR 0017)
  // on a result already known. requested marks the call as resolved so a remount does not re-ask.
  it('does not re-request an abstained category suggestion when the review screen remounts', async () => {
    seedDraft({
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
        remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
      },
      notes: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { forks: ['33333333-3333-3333-3333-333333333333'] },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ category: null, status: 'OK' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderReview();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/ai/categorize');
    await waitFor(() =>
      expect(
        loadDraft(window.sessionStorage, EQUIPMENT_ID, new Date())?.categories.forks?.requested,
      ).toBe(true),
    );

    // Simulate navigating away (checklist) and back (review), which remounts this screen against
    // the same persisted draft.
    unmount();
    renderReview();

    await waitFor(() =>
      expect(screen.getByRole('list', { name: /failed items/i }).textContent).toContain(
        'Forks intact?',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import {
  InspectionDraftProvider,
  useInspectionDraft,
  type SubmissionResult,
} from '@/components/inspection-draft-provider';
import SubmittedFailPage from './page';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const PHOTO_ID = '33333333-3333-3333-3333-333333333333';

vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/checklist/${EQUIPMENT_ID}/submitted/fail`,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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

// Seeds the submission result the review screen would have set via the real setResult call
// (in-memory only, DEV-125), so this test observes the confirmation screen's actual public
// behavior instead of reaching into its internals.
const ResultSeeder = ({ result }: { result: SubmissionResult }): null => {
  const { setResult } = useInspectionDraft();
  useEffect(() => {
    setResult(result);
  }, [result, setResult]);
  return null;
};

const renderFail = (result: SubmissionResult): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <InspectionDraftProvider>
        <ResultSeeder result={result} />
        {children}
      </InspectionDraftProvider>
    </QueryClientProvider>
  );
  return render(<SubmittedFailPage />, { wrapper });
};

const baseResult: Omit<SubmissionResult, 'failures'> = {
  equipmentId: EQUIPMENT_ID,
  inspectionId: '44444444-4444-4444-4444-444444444444',
  result: 'FAIL_WARNING',
};

// jsdom has no real object URL implementation; the hook only needs a stable stand-in to attach
// to the <img> src.
beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:mock-photo-url');
      static revokeObjectURL = vi.fn();
    },
  );
});

describe('fail confirmation screen evidence photo', () => {
  it("fetches the failure's photo from Media by id and renders it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/media/photos/')) {
        expect(url).toBe(`/api/v1/media/photos/${PHOTO_ID}`);
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderFail({
      ...baseResult,
      failures: [{ prompt: 'Forks intact?', notes: 'left fork cracked', photoId: PHOTO_ID }],
    });

    const img = await screen.findByRole('img', { name: /evidence/i });
    expect(img.getAttribute('src')).toBe('blob:mock-photo-url');

    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/media/photos/'))!;
    expect(init?.headers).toEqual({ Authorization: 'Bearer test-token' });
  });

  // The object URL is owned by the mounted card, not by the query cache: a blob: URL pins the
  // photo's bytes in memory until revoked, and an operator can view several fail confirmations
  // in one shift. Ownership living in the component is what makes "revoke on unmount" correct
  // even when two cards share a photoId (DEV-131 review).
  it('revokes the object URL when the card unmounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }),
      } as Response),
    );

    const { unmount } = renderFail({
      ...baseResult,
      failures: [{ prompt: 'Forks intact?', notes: '', photoId: PHOTO_ID }],
    });

    await screen.findByRole('img', { name: /evidence/i });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-photo-url');
  });

  it('shows the placeholder and never calls Media when the failure has no photo id', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderFail({
      ...baseResult,
      failures: [{ prompt: 'Forks intact?', notes: '', photoId: null }],
    });

    expect(screen.queryByRole('img', { name: /evidence/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the placeholder after a failed Media fetch, not before it settles', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderFail({
      ...baseResult,
      failures: [{ prompt: 'Forks intact?', notes: '', photoId: PHOTO_ID }],
    });

    // Proves the fetch was actually attempted and rejected, not that the placeholder is simply
    // the synchronous default an unwired usePhoto would also produce.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('img', { name: /evidence/i })).toBeNull();
  });
});

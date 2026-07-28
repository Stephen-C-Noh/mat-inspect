// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { EvidencePhoto } from './evidence-photo';

const PHOTO_ID = '33333333-3333-3333-3333-333333333333';

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
  }),
}));

const renderEvidencePhoto = (photoId: string | null): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<EvidencePhoto photoId={photoId} />, { wrapper });
};

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

describe('EvidencePhoto', () => {
  it('fetches the photo from Media by id and renders it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`/api/v1/media/photos/${PHOTO_ID}`);
      return { ok: true, status: 200, blob: async () => new Blob(['bytes']) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEvidencePhoto(PHOTO_ID);

    const img = await screen.findByRole('img', { name: /evidence/i });
    expect(img.getAttribute('src')).toBe('blob:mock-photo-url');
  });

  it('shows the placeholder and never calls Media when there is no photo id', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderEvidencePhoto(null);

    expect(screen.queryByRole('img', { name: /evidence/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the placeholder after a failed Media fetch, not before it settles', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderEvidencePhoto(PHOTO_ID);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('img', { name: /evidence/i })).toBeNull();
  });
});

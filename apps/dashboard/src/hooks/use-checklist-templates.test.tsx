// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useChecklistTemplates } from './use-checklist-templates';

// MSAL is the one dependency this hook cannot run without and it is not this project's code
// (CLAUDE.md: mock external services only). fetch and Zod parsing are the real thing below.
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }) },
    accounts: [
      {
        homeAccountId: 'home-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'tenant-id',
        localAccountId: 'local-id',
        username: 'admin@example.edu',
        name: 'Admin User',
        idTokenClaims: { roles: ['admin'] },
      },
    ],
    inProgress: 'none',
  }),
}));

const template = {
  id: '11111111-1111-1111-1111-111111111111',
  equipmentType: 'FORKLIFT',
  version: 1,
  isActive: true,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  items: [
    {
      key: 'forks-condition',
      prompt: 'Forks free of cracks',
      type: 'BOOLEAN',
      required: true,
      failSeverity: 'BLOCKING',
    },
  ],
  createdBy: '22222222-2222-2222-2222-222222222222',
  reviewedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const wrapper = ({ children }: { children: ReactNode }): ReactElement => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChecklistTemplates', () => {
  it('fetches and parses the full template list', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [template] });

    const { result } = renderHook(() => useChecklistTemplates(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([template]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/checklists',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('surfaces a non-ok response as an error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const { result } = renderHook(() => useChecklistTemplates(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('403');
  });
});

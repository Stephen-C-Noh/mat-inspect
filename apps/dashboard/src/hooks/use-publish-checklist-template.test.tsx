// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { usePublishChecklistTemplate } from './use-publish-checklist-template';

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

const publishedTemplate = {
  id: '11111111-1111-1111-1111-111111111111',
  equipmentType: 'FORKLIFT',
  version: 2,
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
  createdAt: '2026-01-02T00:00:00.000Z',
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePublishChecklistTemplate', () => {
  it('POSTs the input without a reviewedBy key and invalidates the template list on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => publishedTemplate });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => usePublishChecklistTemplate(), { wrapper });

    result.current.mutate({
      equipmentType: 'FORKLIFT',
      items: publishedTemplate.items as never,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body).not.toHaveProperty('reviewedBy');
    expect(body.equipmentType).toBe('FORKLIFT');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['checklist-templates'] });
  });

  it('surfaces a non-ok response as an error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });

    const { result } = renderHook(() => usePublishChecklistTemplate(), { wrapper });
    result.current.mutate({ equipmentType: 'FORKLIFT', items: publishedTemplate.items as never });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('400');
  });
});

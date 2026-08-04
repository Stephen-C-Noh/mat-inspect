// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import type { ChecklistTemplate } from '@mat-inspect/shared-schemas';
import { PublishTemplateWizard } from './publish-template-wizard';

// MSAL is the one dependency the underlying publish hook cannot run without and it is not this
// project's code (CLAUDE.md: mock external services only). fetch is stubbed per-test below; the
// hook, the diff logic, and the wizard's own state machine are all the real thing.
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

// jsdom has no PointerEvent capture implementation, which Radix's Select relies on; the item
// builder's Select is not exercised directly in these tests, but Dialog's own focus handling
// touches scrollIntoView, which jsdom also lacks.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const currentActive: ChecklistTemplate = {
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

const publishedTemplate: ChecklistTemplate = {
  ...currentActive,
  version: 2,
  createdAt: '2026-01-02T00:00:00.000Z',
};

let fetchMock: ReturnType<typeof vi.fn>;
let onClose: () => void;

const renderWizard = (): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  render(
    <Wrapper>
      <PublishTemplateWizard
        equipmentType="FORKLIFT"
        currentActive={currentActive}
        onClose={onClose}
      />
    </Wrapper>,
  );
};

beforeEach(() => {
  fetchMock = vi.fn();
  onClose = vi.fn(() => {});
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('PublishTemplateWizard', () => {
  it('walks editing -> diff review -> confirm -> success, then closes', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => publishedTemplate });

    renderWizard();

    // Seeded from the active template's items.
    expect(screen.getByDisplayValue('Forks free of cracks')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: /review changes/i }));

    // Editing with no changes yet: the diff should report nothing to publish.
    expect(screen.getByText(/no changes from the active version/i)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: /confirm publish/i }));

    await waitFor(() => expect(screen.getByText(/published successfully/i)).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/checklists',
      expect.objectContaining({ method: 'POST' }),
    );

    await userEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the added item in the diff preview before publishing', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => publishedTemplate });
    renderWizard();

    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    await userEvent.type(screen.getAllByLabelText('Key')[1]!, 'new-check');
    await userEvent.type(screen.getAllByLabelText('Prompt')[1]!, 'New prompt');

    await userEvent.click(screen.getByRole('button', { name: /review changes/i }));

    expect(screen.getByText(/added \(1\)/i)).toBeDefined();
    expect(screen.getByText(/new-check/)).toBeDefined();
  });

  it('preserves the draft and shows an error message when the publish request fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderWizard();

    await userEvent.click(screen.getByRole('button', { name: /review changes/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm publish/i }));

    await waitFor(() => expect(screen.getByText(/failed to publish/i)).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: /back to edit/i }));
    // Draft survives the failed round trip.
    expect(screen.getByDisplayValue('Forks free of cracks')).toBeDefined();
  });
});

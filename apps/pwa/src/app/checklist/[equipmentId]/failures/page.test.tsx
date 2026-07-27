// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import { InspectionDraftProvider } from '@/components/inspection-draft-provider';
import { saveDraft } from '@/lib/inspection-draft-storage';
import FailuresPage from './page';

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';
const PHOTO_ID = '33333333-3333-3333-3333-333333333333';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ equipmentId: EQUIPMENT_ID }),
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/checklist/${EQUIPMENT_ID}/failures`,
}));

// next/link needs the App Router context, which this render does not provide. The screen only
// uses it for the back link, so an anchor is a faithful enough stand-in.
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

const forks: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

const seedDocumentedFailure = (): void => {
  saveDraft(
    window.sessionStorage,
    {
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [forks],
      answers: { forks: { kind: 'BOOLEAN', passed: false } },
      inlineNotes: {},
      failureDocs: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          photoIds: [PHOTO_ID],
        },
      },
    },
    new Date(),
  );
};

const renderFailures = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactElement }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <InspectionDraftProvider>{children}</InspectionDraftProvider>
    </QueryClientProvider>
  );
  return render(<FailuresPage />, { wrapper });
};

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  push.mockClear();
  vi.unstubAllGlobals();
});

describe('failure documentation screen submit action', () => {
  // The fail path had the same defect as the clean path (DEV-126): it documented defects and then
  // POSTed, so the attestation was never affirmed. It now hands off to the same review screen.
  it('sends the operator to the review screen instead of POSTing the inspection', async () => {
    seedDocumentedFailure();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderFailures();

    await userEvent.click(await screen.findByRole('button', { name: /review and submit/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/checklist/${EQUIPMENT_ID}/review`));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

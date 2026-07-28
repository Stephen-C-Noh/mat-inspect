// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TopBar } from './top-bar';

// MSAL is the one dependency this component cannot run without and it is not this project's
// code (CLAUDE.md: mock external services only). hasAllowedRole (from @mat-inspect/shared-auth)
// is real project code.
const mockMsalState = vi.hoisted(() => ({ accounts: [] as unknown[] }));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: mockMsalState.accounts }),
}));

// NotificationBell needs ActivityProvider (equipment/defect polling) to render at all; that
// machinery is unrelated to what this test covers (the Admin link's role gating), so it is
// stubbed out rather than dragging in a QueryClientProvider and fetch mocks for it.
vi.mock('@/components/ui/notification-bell', () => ({
  NotificationBell: () => null,
}));

const accountWithRoles = (roles: string[]): unknown => ({
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  localAccountId: 'local-id',
  username: 'jane.doe@example.edu',
  name: 'Jane Doe',
  idTokenClaims: { roles },
});

beforeEach(() => {
  mockMsalState.accounts = [];
});

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  it('renders nothing when there is no active account', () => {
    const { container } = render(<TopBar />);
    expect(container.firstChild).toBeNull();
  });

  it('does not show the Admin link for a supervisor account', () => {
    mockMsalState.accounts = [accountWithRoles(['supervisor'])];
    render(<TopBar />);

    expect(screen.getByText('Fleet')).toBeDefined();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('shows the Admin link pointing at /admin/templates for an admin account', () => {
    mockMsalState.accounts = [accountWithRoles(['admin'])];
    render(<TopBar />);

    const adminLink = screen.getByText('Admin').closest('a');
    expect(adminLink?.getAttribute('href')).toBe('/admin/templates');
  });
});

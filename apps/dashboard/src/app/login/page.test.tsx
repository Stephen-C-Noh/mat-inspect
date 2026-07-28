// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import LoginPage from './page';

const replace = vi.fn();
const loginRedirect = vi.fn();

// Next's router and MSAL are the two things this page cannot run without and neither belongs
// to this project's code, so they are stubbed at the module boundary (CLAUDE.md: mock external
// services only). hasAllowedRole (from @mat-inspect/shared-auth) is real project code.
const mockMsalState = vi.hoisted(() => ({
  isAuthenticated: false,
  inProgress: 'none' as string,
  accounts: [] as unknown[],
}));

let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

vi.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockMsalState.isAuthenticated,
  useMsal: () => ({
    accounts: mockMsalState.accounts,
    inProgress: mockMsalState.inProgress,
    instance: { loginRedirect },
  }),
}));

const supervisorAccount = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  localAccountId: 'local-id',
  username: 'jane.doe@example.edu',
  name: 'Jane Doe',
  idTokenClaims: { roles: ['supervisor'] },
};

beforeEach(() => {
  replace.mockClear();
  loginRedirect.mockClear();
  mockMsalState.isAuthenticated = false;
  mockMsalState.inProgress = 'none';
  mockMsalState.accounts = [];
  searchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

describe('LoginPage', () => {
  it('sends an already-authenticated, allowed-role user to /dashboard with no requested path', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.accounts = [supervisorAccount];

    render(<LoginPage />);

    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('restores the originally requested path after sign-in for an allowed-role user', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.accounts = [supervisorAccount];
    searchParams = new URLSearchParams({ redirect: '/fleet' });

    render(<LoginPage />);

    expect(replace).toHaveBeenCalledWith('/fleet');
  });

  it('falls back to /dashboard when the requested path is an open-redirect attempt', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.accounts = [supervisorAccount];
    searchParams = new URLSearchParams({ redirect: '//evil.com' });

    render(<LoginPage />);

    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('sends a signed-in user without an allowed role to /unauthorized even with a requested path', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.accounts = [{ ...supervisorAccount, idTokenClaims: { roles: ['operator'] } }];
    searchParams = new URLSearchParams({ redirect: '/fleet' });

    render(<LoginPage />);

    expect(replace).toHaveBeenCalledWith('/unauthorized');
  });

  it('disables the sign-in button while MSAL is still starting up', () => {
    // Clicking while MSAL is still restoring the cached session (Startup) or processing a
    // just-completed Entra redirect (HandleRedirect) throws BrowserAuthError:
    // interaction_in_progress, which the catch block below swallows silently, so the button
    // looks dead. Disable it instead of letting that click happen.
    mockMsalState.inProgress = 'startup';

    render(<LoginPage />);

    const button = screen.getByRole('button', {
      name: /sign in with microsoft/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('enables the sign-in button once MSAL has settled', () => {
    mockMsalState.inProgress = 'none';

    render(<LoginPage />);

    const button = screen.getByRole('button', {
      name: /sign in with microsoft/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});

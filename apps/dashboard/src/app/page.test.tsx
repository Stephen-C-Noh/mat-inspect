// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import RootPage from './page';

const replace = vi.fn();

// Next's router and MSAL are the two things this page cannot run without and neither belongs
// to this project's code, so they are stubbed at the module boundary (CLAUDE.md: mock external
// services only). hasAllowedRole (from @mat-inspect/shared-auth) is real project code.
const mockMsalState = vi.hoisted(() => ({
  isAuthenticated: false,
  inProgress: 'none' as string,
  accounts: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockMsalState.isAuthenticated,
  useMsal: () => ({ accounts: mockMsalState.accounts, inProgress: mockMsalState.inProgress }),
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
  mockMsalState.isAuthenticated = false;
  mockMsalState.inProgress = 'none';
  mockMsalState.accounts = [];
});

afterEach(() => {
  cleanup();
});

describe('RootPage', () => {
  it('does not redirect while MSAL is still processing the Entra return (handleRedirect)', () => {
    // "/" is the app's configured redirectUri: Entra lands the auth-code fragment here after
    // sign-in. Redirecting away before handleRedirectPromise() resolves can drop that fragment.
    mockMsalState.isAuthenticated = false;
    mockMsalState.inProgress = 'handleRedirect';

    render(<RootPage />);

    expect(replace).not.toHaveBeenCalled();
  });

  it('sends an authenticated, allowed-role user to /dashboard once MSAL has settled', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.inProgress = 'none';
    mockMsalState.accounts = [supervisorAccount];

    render(<RootPage />);

    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('sends an unauthenticated user to /login once MSAL has settled', () => {
    mockMsalState.isAuthenticated = false;
    mockMsalState.inProgress = 'none';

    render(<RootPage />);

    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('sends a signed-in user without an allowed role to /unauthorized', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.inProgress = 'none';
    mockMsalState.accounts = [{ ...supervisorAccount, idTokenClaims: { roles: ['operator'] } }];

    render(<RootPage />);

    expect(replace).toHaveBeenCalledWith('/unauthorized');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthGuard } from './auth-guard';

const replace = vi.fn();

// Next's router and MSAL are the two things this component cannot run without and neither
// belongs to this project's code, so they are stubbed at the module boundary (CLAUDE.md: mock
// external services only). hasAllowedRole (from @mat-inspect/shared-auth) is real project code.
const mockMsalState = vi.hoisted(() => ({
  isAuthenticated: false,
  inProgress: 'none' as string,
  accounts: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/fleet',
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

describe('AuthGuard', () => {
  it('renders nothing and does not redirect while MSAL is still initializing', () => {
    mockMsalState.isAuthenticated = false;
    mockMsalState.inProgress = 'startup';

    const { container } = render(
      <AuthGuard>
        <div>Fleet page</div>
      </AuthGuard>,
    );

    expect(container.firstChild).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders children once MSAL has settled for an authenticated, allowed-role user', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.inProgress = 'none';
    mockMsalState.accounts = [supervisorAccount];

    render(
      <AuthGuard>
        <div>Fleet page</div>
      </AuthGuard>,
    );

    expect(screen.getByText('Fleet page')).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to /login with the requested path preserved once MSAL has settled unauthenticated', () => {
    mockMsalState.isAuthenticated = false;
    mockMsalState.inProgress = 'none';

    render(
      <AuthGuard>
        <div>Fleet page</div>
      </AuthGuard>,
    );

    expect(replace).toHaveBeenCalledWith('/login?redirect=%2Ffleet');
  });

  it('redirects to /unauthorized once MSAL has settled for a signed-in user without an allowed role', () => {
    mockMsalState.isAuthenticated = true;
    mockMsalState.inProgress = 'none';
    mockMsalState.accounts = [{ ...supervisorAccount, idTokenClaims: { roles: ['operator'] } }];

    render(
      <AuthGuard>
        <div>Fleet page</div>
      </AuthGuard>,
    );

    expect(replace).toHaveBeenCalledWith('/unauthorized');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from './page';

const back = vi.fn();
const logoutRedirect = vi.fn();

const mockMsalState = vi.hoisted(() => ({
  accounts: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => true,
  useMsal: () => ({
    accounts: mockMsalState.accounts,
    inProgress: 'none',
    instance: { logoutRedirect },
  }),
}));

const managerAccount = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  localAccountId: 'local-id',
  username: 'jane.doe@example.edu',
  name: 'Jane Doe',
  idTokenClaims: { roles: ['manager'] },
};

beforeEach(() => {
  back.mockClear();
  logoutRedirect.mockClear();
  mockMsalState.accounts = [managerAccount];
});

afterEach(() => {
  cleanup();
});

describe('dashboard settings page', () => {
  it('shows the signed-in account and its role', () => {
    render(<SettingsPage />);

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('Manager')).toBeTruthy();
  });

  it('navigates back on the header button', async () => {
    render(<SettingsPage />);

    await userEvent.click(screen.getByRole('button', { name: /go back/i }));

    expect(back).toHaveBeenCalledTimes(1);
  });

  it('signs out from the Account section', async () => {
    render(<SettingsPage />);

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(logoutRedirect).toHaveBeenCalledTimes(1);
  });
});

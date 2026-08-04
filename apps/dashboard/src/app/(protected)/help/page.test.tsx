// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HelpPage from './page';

const back = vi.fn();

const mockMsalState = vi.hoisted(() => ({
  accounts: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back }),
  usePathname: () => '/help',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => true,
  useMsal: () => ({ accounts: mockMsalState.accounts, inProgress: 'none' }),
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
  back.mockClear();
  mockMsalState.accounts = [supervisorAccount];
});

afterEach(() => {
  cleanup();
});

describe('dashboard help page', () => {
  it('navigates back on the header button', async () => {
    render(<HelpPage />);

    await userEvent.click(screen.getByRole('button', { name: /go back/i }));

    expect(back).toHaveBeenCalledTimes(1);
  });

  it('expands an FAQ item on click', async () => {
    render(<HelpPage />);

    const question = screen.getByRole('button', { name: /equipment status badges/i });
    await userEvent.click(question);

    expect(screen.getByText(/AWAITING_INSPECTION/)).toBeTruthy();
  });
});

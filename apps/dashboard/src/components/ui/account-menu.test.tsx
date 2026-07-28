// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from './account-menu';

const logoutRedirect = vi.fn();

const account = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  localAccountId: 'local-id',
  username: 'jane.doe@example.edu',
  name: 'Jane Doe',
  idTokenClaims: { roles: ['operator'], login_hint: 'jane.doe@example.edu' },
};

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { logoutRedirect },
    accounts: [account],
  }),
}));

beforeEach(() => {
  cleanup();
  logoutRedirect.mockClear();
});

describe('AccountMenu', () => {
  it('opens the menu and shows the signed-in account', async () => {
    render(<AccountMenu />);

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('jane.doe@example.edu')).toBeTruthy();
  });

  // Passing the active account and its login_hint lets Entra skip the "which account do you
  // want to sign out of?" picker when the browser holds more than one Microsoft session.
  it('signs out targeting the active account and its login_hint', async () => {
    render(<AccountMenu />);

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));

    expect(logoutRedirect).toHaveBeenCalledWith({
      account,
      logoutHint: 'jane.doe@example.edu',
    });
  });

  it('closes the menu on an outside click', async () => {
    render(
      <div>
        <AccountMenu />
        <button type="button">outside</button>
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menu')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

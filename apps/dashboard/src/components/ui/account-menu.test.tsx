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

  // No account field: sign-out clears the whole local MSAL cache, not just this one (DEV-151).
  // logoutHint still lets Entra skip its own "which account do you want to sign out of?"
  // picker when the browser holds more than one Microsoft session.
  it('signs out clearing the whole cache, hinting the active account to Entra', async () => {
    render(<AccountMenu />);

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));

    expect(logoutRedirect).toHaveBeenCalledWith({
      logoutHint: 'jane.doe@example.edu',
    });
  });

  it('links to Settings and Help and closes the menu on click', async () => {
    render(<AccountMenu />);

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

    const settingsLink = screen.getByRole('menuitem', { name: /settings/i });
    expect(settingsLink).toHaveProperty('href', expect.stringContaining('/settings'));
    const helpLink = screen.getByRole('menuitem', { name: /help/i });
    expect(helpLink).toHaveProperty('href', expect.stringContaining('/help'));

    await userEvent.click(settingsLink);
    expect(screen.queryByRole('menu')).toBeNull();
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

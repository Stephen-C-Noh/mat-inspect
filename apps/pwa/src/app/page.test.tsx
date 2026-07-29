// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import EquipmentPage from './page';

const mockMsalState = vi.hoisted(() => ({
  accounts: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: mockMsalState.accounts, inProgress: 'none' }),
  useIsAuthenticated: () => true,
}));

vi.mock('../hooks/use-equipment', () => ({
  useEquipmentList: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/use-my-inspections', () => ({
  useMyInspections: () => ({ data: [] }),
}));

const operatorAccount = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  localAccountId: 'local-id',
  username: 'jo.operator@example.edu',
  name: 'Jo Operator',
  idTokenClaims: { roles: ['operator'] },
};

const supervisorAccount = {
  ...operatorAccount,
  username: 'sam.supervisor@example.edu',
  name: 'Sam Supervisor',
  idTokenClaims: { roles: ['supervisor'] },
};

beforeEach(() => {
  mockMsalState.accounts = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

// DEV-116: the PWA's home screen "Dashboard" button linked to '/' (itself). It should instead
// link out to the separate apps/dashboard app, and only for roles that have a use for it.
describe('home screen Dashboard link', () => {
  it('is hidden for an operator, who has no manager dashboard to go to', () => {
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_URL', 'https://dashboard.mat-inspect.staging');
    mockMsalState.accounts = [operatorAccount];

    render(<EquipmentPage />);

    expect(screen.queryByRole('link', { name: /dashboard/i })).toBeNull();
  });

  it('links a supervisor out to the dashboard app origin', () => {
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_URL', 'https://dashboard.mat-inspect.staging');
    mockMsalState.accounts = [supervisorAccount];

    render(<EquipmentPage />);

    expect(screen.getByRole('link', { name: /dashboard/i }).getAttribute('href')).toBe(
      'https://dashboard.mat-inspect.staging',
    );
  });

  it('stays hidden for a supervisor when no dashboard origin is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_URL', '');
    mockMsalState.accounts = [supervisorAccount];

    render(<EquipmentPage />);

    expect(screen.queryByRole('link', { name: /dashboard/i })).toBeNull();
  });
});

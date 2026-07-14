import { describe, expect, it, vi } from 'vitest';
import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { acquireApiToken } from './access-token';
import { createTokenRequest } from './msal-config';

const CLIENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const tokenRequest = createTokenRequest(CLIENT_ID);

const account = { homeAccountId: 'home', username: 'operator@sait.ca' } as AccountInfo;

// Only the two token methods are called. Everything else on the MSAL instance is unused.
const makeInstance = (overrides: Partial<IPublicClientApplication>): IPublicClientApplication =>
  ({
    acquireTokenSilent: vi.fn(),
    acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as IPublicClientApplication;

describe('acquireApiToken', () => {
  it('returns the access token from a silent acquisition', async () => {
    const acquireTokenSilent = vi.fn().mockResolvedValue({ accessToken: 'token-abc' });
    const instance = makeInstance({ acquireTokenSilent });

    await expect(acquireApiToken(instance, [account], tokenRequest)).resolves.toBe('token-abc');
    expect(acquireTokenSilent).toHaveBeenCalledWith({ ...tokenRequest, account });
  });

  it('redirects to re-authenticate when interaction is required', async () => {
    const acquireTokenRedirect = vi.fn().mockResolvedValue(undefined);
    const instance = makeInstance({
      acquireTokenSilent: vi.fn().mockRejectedValue(new InteractionRequiredAuthError()),
      acquireTokenRedirect,
    });

    await expect(acquireApiToken(instance, [account], tokenRequest)).rejects.toBeInstanceOf(
      InteractionRequiredAuthError,
    );
    expect(acquireTokenRedirect).toHaveBeenCalledWith({ ...tokenRequest, account });
  });

  it('rethrows after starting the redirect, so callers can fail soft (ADR 0017)', async () => {
    const interactionRequired = new InteractionRequiredAuthError();
    const instance = makeInstance({
      acquireTokenSilent: vi.fn().mockRejectedValue(interactionRequired),
    });

    await expect(acquireApiToken(instance, [account], tokenRequest)).rejects.toBe(
      interactionRequired,
    );
  });

  it('rethrows other errors without redirecting', async () => {
    const acquireTokenRedirect = vi.fn();
    const networkError = new Error('network down');
    const instance = makeInstance({
      acquireTokenSilent: vi.fn().mockRejectedValue(networkError),
      acquireTokenRedirect,
    });

    await expect(acquireApiToken(instance, [account], tokenRequest)).rejects.toBe(networkError);
    expect(acquireTokenRedirect).not.toHaveBeenCalled();
  });
});

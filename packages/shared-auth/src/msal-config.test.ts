import { describe, expect, it } from 'vitest';
import { apiScope, createLoginRequest, createMsalConfig, createTokenRequest } from './msal-config';

const CLIENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TENANT_ID = 'tttttttt-tttt-tttt-tttt-tttttttttttt';

describe('createMsalConfig', () => {
  it('builds the tenant authority from the tenant id', () => {
    const config = createMsalConfig({ clientId: CLIENT_ID, tenantId: TENANT_ID });
    expect(config.auth.authority).toBe(`https://login.microsoftonline.com/${TENANT_ID}`);
    expect(config.auth.clientId).toBe(CLIENT_ID);
  });

  it('leaves the redirect URIs empty when there is no window', () => {
    // Server-side render. MSAL is only instantiated in the browser, where the origin is
    // read; an empty string here means the config never carries a wrong redirect URI.
    const config = createMsalConfig({ clientId: CLIENT_ID, tenantId: TENANT_ID });
    expect(config.auth.redirectUri).toBe('');
    expect(config.auth.postLogoutRedirectUri).toBe('');
  });

  it('keeps the token cache in sessionStorage', () => {
    const config = createMsalConfig({ clientId: CLIENT_ID, tenantId: TENANT_ID });
    expect(config.cache?.cacheLocation).toBe('sessionStorage');
    expect(config.cache?.storeAuthStateInCookie).toBe(false);
  });
});

describe('apiScope', () => {
  it('names the access_as_user scope on the app registration', () => {
    expect(apiScope(CLIENT_ID)).toBe(`api://${CLIENT_ID}/access_as_user`);
  });
});

describe('createTokenRequest', () => {
  it('requests only the API scope', () => {
    expect(createTokenRequest(CLIENT_ID).scopes).toEqual([`api://${CLIENT_ID}/access_as_user`]);
  });
});

describe('createLoginRequest', () => {
  it('asks for identity scopes only by default (the dashboard)', () => {
    expect(createLoginRequest(CLIENT_ID)).toEqual({
      scopes: ['openid', 'profile'],
      prompt: 'select_account',
    });
  });

  it('adds the API scope for apps that call the API (the PWA)', () => {
    expect(createLoginRequest(CLIENT_ID, { withApiScope: true }).scopes).toEqual([
      'openid',
      'profile',
      `api://${CLIENT_ID}/access_as_user`,
    ]);
  });

  it('always shows the account picker', () => {
    expect(createLoginRequest(CLIENT_ID, { withApiScope: true }).prompt).toBe('select_account');
  });
});

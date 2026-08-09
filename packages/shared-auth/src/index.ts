export { acquireApiToken, acquireApiTokenSilent } from './access-token';
export { getActiveAccount, getLogoutHint, wireActiveAccount } from './active-account';
export {
  apiScope,
  createLoginRequest,
  createMsalConfig,
  createTokenRequest,
  type EntraConfig,
  type LoginRequest,
  type TokenRequest,
} from './msal-config';
export { getRolesFromAccount, hasAllowedRole } from './roles';

export { acquireApiToken } from './access-token';
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

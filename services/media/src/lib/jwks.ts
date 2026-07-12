import { createRemoteJWKSet } from 'jose';

// Resolves the JSON Web Key Set used to verify operator access tokens (ADR 0002, ADR 0012).
// Mirrors core-api's jwks.ts; the only difference is the dev fallback target, because the Media
// Service does not issue tokens of its own.

let cached: ReturnType<typeof createRemoteJWKSet> | null = null;

const resolveJwksUri = (): string => {
  const tenantId = process.env['ENTRA_TENANT_ID'];
  if (tenantId) {
    return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  }
  // Dev fallback: in local development the operator token is minted by core-api's dev-token route
  // (services/core-api dev-token.ts), so verify it against core-api's dev JWKS over the internal
  // Docker network. DEV_JWKS_URL overrides the address when core-api is reachable elsewhere.
  return process.env['DEV_JWKS_URL'] ?? 'http://core-api:3000/dev/jwks';
};

export const getJwks = (): ReturnType<typeof createRemoteJWKSet> => {
  if (!cached) {
    cached = createRemoteJWKSet(new URL(resolveJwksUri()));
  }
  return cached;
};

// Only for use in tests to reset state between test cases.
export const resetJwksForTest = (): void => {
  cached = null;
};

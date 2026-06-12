import { createRemoteJWKSet } from 'jose';

let cached: ReturnType<typeof createRemoteJWKSet> | null = null;

const resolveJwksUri = (): string => {
  const tenantId = process.env['ENTRA_TENANT_ID'];
  if (tenantId) {
    return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  }
  // Dev fallback: served by the same process via /dev/jwks
  const port = process.env['PORT'] ?? '3000';
  return `http://localhost:${port}/dev/jwks`;
};

export const getJwks = (): ReturnType<typeof createRemoteJWKSet> => {
  if (!cached) {
    cached = createRemoteJWKSet(new URL(resolveJwksUri()));
  }
  return cached;
};

// Only for use in tests to reset state between test cases
export const resetJwksForTest = (): void => {
  cached = null;
};

// Dev-only: JWKS endpoint and token issuer for local development without a real Entra ID tenant.
// These routes are NOT registered in production (guarded by NODE_ENV check in app.ts).
import type { FastifyPluginAsync } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { UserRole } from '@mat-inspect/shared-types';

// Ephemeral keypair generated at startup; changes on each restart (intentional for dev).
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'dev-1', alg: 'RS256', use: 'sig' };

export const devTokenRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dev/jwks', async (_req, reply) => {
    return reply.send({ keys: [publicJwk] });
  });

  // Issues a signed JWT for the given role. For development and integration tests only.
  // Example: GET /dev/token?role=operator&sub=test-operator-id
  app.get<{ Querystring: { role?: string; sub?: string } }>('/dev/token', async (req, reply) => {
    const role = (req.query.role ?? 'operator') as UserRole;
    const sub = req.query.sub ?? 'dev-user-00000000-0000-0000-0000-000000000001';

    const token = await new SignJWT({ sub, oid: sub, roles: [role], tid: 'dev-tenant' })
      .setProtectedHeader({ alg: 'RS256', kid: 'dev-1' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    return reply.send({ token });
  });
};

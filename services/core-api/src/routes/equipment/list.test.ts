import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../../middleware/auth.js';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

vi.mock('../../lib/jwks.js', () => ({
  getJwks: () => localJwks,
  resetJwksForTest: vi.fn(),
}));

const makeToken = async (claims: Record<string, unknown> = {}) =>
  new SignJWT({ sub: 'user-1', oid: 'user-1', roles: ['operator'], tid: 'test-tenant', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

describe('GET /api/v1/equipment', () => {
  beforeEach(() => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];
  });

  it('rejects with 401 when no Authorization header is provided', async () => {
    const req = { headers: {} } as unknown as FastifyRequest;
    const reply = {} as FastifyReply;

    await expect(requireRole('operator')(req, reply)).rejects.toMatchObject({
      status: 401,
      code: 'MISSING_TOKEN',
    });
  });

  it('rejects with 401 when Authorization header is not Bearer', async () => {
    const req = {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    } as unknown as FastifyRequest;
    const reply = {} as FastifyReply;

    await expect(requireRole('operator')(req, reply)).rejects.toMatchObject({
      status: 401,
      code: 'MISSING_TOKEN',
    });
  });

  it('rejects with 403 when the token carries no roles', async () => {
    const token = await makeToken({ roles: [] });
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    const reply = {} as FastifyReply;

    await expect(requireRole('operator')(req, reply)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});

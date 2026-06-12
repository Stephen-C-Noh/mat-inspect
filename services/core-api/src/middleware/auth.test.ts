import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import Fastify, { type FastifyError } from 'fastify';
import { verifyToken, requireRole } from './auth.js';
import { resetJwksForTest } from '../lib/jwks.js';

// Generate a test keypair once for the suite
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// Replace the remote JWKS fetch with an in-memory set for all tests
vi.mock('../lib/jwks.js', () => ({
  getJwks: () => localJwks,
  resetJwksForTest: vi.fn(),
}));

const makeToken = async (claims: Record<string, unknown> = {}, expiresIn = '15m') =>
  new SignJWT({ sub: 'user-1', oid: 'user-1', roles: ['operator'], tid: 'test-tenant', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);

const buildTestApp = () => {
  const app = Fastify();

  app.setErrorHandler((err: FastifyError & { status?: number; code?: string }, _req, reply) => {
    const status = err.status ?? err.statusCode ?? 500;
    void reply.code(status).send({ code: err.code, detail: err.message });
  });

  app.get('/protected', { preHandler: [verifyToken] }, async (req) => ({ userId: req.user.id }));

  app.get('/operator-only', { preHandler: [requireRole('operator')] }, async (req) => ({
    userId: req.user.id,
  }));

  app.get('/manager-or-admin', { preHandler: [requireRole('manager', 'admin')] }, async (req) => ({
    userId: req.user.id,
  }));

  return app;
};

describe('verifyToken', () => {
  beforeEach(() => {
    resetJwksForTest();
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];
  });

  it('populates req.user from a valid token', async () => {
    const app = buildTestApp();
    const token = await makeToken({ oid: 'user-abc', roles: ['operator'], tid: 'tenant-1' });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'user-abc' });
  });

  it('falls back to sub when oid is absent', async () => {
    const app = buildTestApp();
    const token = await new SignJWT({ sub: 'sub-only', roles: [] })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'sub-only' });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('MISSING_TOKEN');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('MISSING_TOKEN');
  });

  it('returns 401 for an expired token', async () => {
    const app = buildTestApp();
    // Use a past Unix timestamp (seconds) to create an already-expired token
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({ sub: 'user-1', oid: 'user-1', roles: ['operator'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
      .setIssuedAt(expiredAt - 30)
      .setExpirationTime(expiredAt)
      .sign(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a tampered token', async () => {
    const app = buildTestApp();
    const token = await makeToken();
    const [header, , sig] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'evil', roles: ['admin'] })).toString(
      'base64url',
    );

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${header}.${tamperedPayload}.${sig}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_TOKEN');
  });
});

describe('requireRole', () => {
  beforeEach(() => {
    resetJwksForTest();
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];
  });

  it('allows access when the user has the required role', async () => {
    const app = buildTestApp();
    const token = await makeToken({ oid: 'op-1', roles: ['operator'] });

    const res = await app.inject({
      method: 'GET',
      url: '/operator-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when the user lacks the required role', async () => {
    const app = buildTestApp();
    const token = await makeToken({ roles: ['operator'] });

    const res = await app.inject({
      method: 'GET',
      url: '/manager-or-admin',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('allows access when the user has any of the accepted roles', async () => {
    const app = buildTestApp();
    const token = await makeToken({ roles: ['admin'] });

    const res = await app.inject({
      method: 'GET',
      url: '/manager-or-admin',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 401 (not 403) when no token is provided', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/operator-only' });

    expect(res.statusCode).toBe(401);
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { setJwksForTest } from '../../middleware/auth.js';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// Inject the local key set so token verification never reaches the network. The shared
// verifier owns the JWKS fetch (DEV-98); tests hand it keys instead of mocking the module.
setJwksForTest(localJwks);

const AI_SERVICE_URL = 'http://ai.test:8000';

const makeToken = async (roles: string[]) =>
  new SignJWT({ sub: 'operator-1', oid: 'operator-1', roles, tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;

const post = async (opts: { token?: string; body?: unknown }) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/ai/categorize',
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      'content-type': 'application/json',
    },
    payload: opts.body ?? { noteText: 'oil leaking from the hoist' },
  });

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
  process.env['AI_SERVICE_URL'] = AI_SERVICE_URL;
  delete process.env['ENTRA_TENANT_ID'];
  delete process.env['ENTRA_CLIENT_ID'];

  const { buildApp } = await import('../../app.js');
  app = await buildApp();
  await app.ready();

  operatorToken = await makeToken(['operator']);
  managerToken = await makeToken(['manager']);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubUpstream = (res: Response) => {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/v1/ai/categorize', () => {
  it('returns a suggested category to an authenticated operator', async () => {
    const fetchMock = stubUpstream(jsonResponse({ category: 'LEAK', status: 'OK' }));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: 'LEAK', status: 'OK' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(`${AI_SERVICE_URL}/advisory`);
  });

  it('sends note_text in the AI Service request shape', async () => {
    const fetchMock = stubUpstream(jsonResponse({ category: null, status: 'OK' }));

    await post({ token: operatorToken, body: { noteText: 'frayed cable strand' } });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ note_text: 'frayed cable strand' });
  });

  it('does not forward the operator bearer token to the AI Service', async () => {
    const fetchMock = stubUpstream(jsonResponse({ category: null, status: 'OK' }));

    await post({ token: operatorToken });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('rejects an unauthenticated request and never calls the AI Service', async () => {
    const fetchMock = stubUpstream(jsonResponse({ category: null, status: 'OK' }));

    const res = await post({});

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a caller without the operator role', async () => {
    const fetchMock = stubUpstream(jsonResponse({ category: null, status: 'OK' }));

    const res = await post({ token: managerToken });

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is fail-open: an unreachable AI Service answers 200 UNAVAILABLE, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: null, status: 'UNAVAILABLE' });
  });

  it('is fail-open: an upstream 5xx answers 200 UNAVAILABLE, not a bad gateway', async () => {
    const upstream = jsonResponse({ detail: 'model busy' }, 503);
    stubUpstream(upstream);

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: null, status: 'UNAVAILABLE' });
    // undici holds the socket until the body is consumed.
    expect(upstream.bodyUsed).toBe(true);
  });

  it('is fail-open: a 200 that is not JSON answers 200 UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 })),
    );

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: null, status: 'UNAVAILABLE' });
  });

  it('is fail-open: a response shape mismatch answers 200 UNAVAILABLE', async () => {
    stubUpstream(jsonResponse({ flagged: true, status: 'OK' }));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: null, status: 'UNAVAILABLE' });
  });

  it('is fail-open: an upstream OTHER category (never model-suggestable) answers UNAVAILABLE', async () => {
    // ADR 0028: the model may suggest one of the seven substantive values or abstain; it never
    // suggests OTHER. A response that somehow carries OTHER is a contract violation, not a
    // suggestion to pass through.
    stubUpstream(jsonResponse({ category: 'OTHER', status: 'OK' }));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: null, status: 'UNAVAILABLE' });
  });

  it('does not log the note text', async () => {
    const { logger } = await import('../../lib/logger.js');
    const info = vi.spyOn(logger, 'info');
    stubUpstream(jsonResponse({ category: 'DAMAGE', status: 'OK' }));

    await post({ token: operatorToken, body: { noteText: 'secret defect description' } });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('secret defect description');
  });
});

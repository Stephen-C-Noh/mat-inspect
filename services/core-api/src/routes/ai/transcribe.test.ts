import { Readable } from 'node:stream';
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

const BOUNDARY = '----matinspect';
const multipart = (clip: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="clip"; filename="clip.webm"\r\n` +
        `Content-Type: audio/webm\r\n\r\n`,
    ),
    clip,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);

const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;

const post = async (opts: {
  token?: string;
  payload?: Buffer | Readable;
  contentType?: string;
  headers?: Record<string, string>;
}) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/ai/transcribe',
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.contentType === undefined ? { 'content-type': CONTENT_TYPE } : {}),
      ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
      ...opts.headers,
    },
    payload: opts.payload ?? multipart(Buffer.from('fake-audio-bytes')),
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

describe('POST /api/v1/ai/transcribe', () => {
  it('returns the transcript to an authenticated operator', async () => {
    const fetchMock = stubUpstream(jsonResponse({ text: 'hydraulic leak on the mast' }));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: 'hydraulic leak on the mast' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(`${AI_SERVICE_URL}/transcribe`);
  });

  it('forwards the multipart content type with its boundary', async () => {
    const fetchMock = stubUpstream(jsonResponse({ text: 'ok' }));

    await post({ token: operatorToken });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['content-type']).toBe(CONTENT_TYPE);
    // A sized body is what makes undici set content-length, which the AI Service requires. A stream
    // would be sent chunked and answered with 411.
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect((init.body as Uint8Array).byteLength).toBe(
      multipart(Buffer.from('fake-audio-bytes')).length,
    );
  });

  it('does not forward the operator bearer token to the AI Service', async () => {
    // The AI Service does not authenticate. Passing the token on would widen where it can leak
    // without buying anything.
    const fetchMock = stubUpstream(jsonResponse({ text: 'ok' }));

    await post({ token: operatorToken });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('rejects an unauthenticated request and never calls the AI Service', async () => {
    const fetchMock = stubUpstream(jsonResponse({ text: 'ok' }));

    const res = await post({});

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reads the body of an unauthenticated request', async () => {
    // Fastify parses the body between onRequest and preHandler, so authenticating in a preHandler
    // would let an anonymous caller push a 10 MB clip into core-api's memory and only then be told
    // 401. Auth runs in onRequest instead. This test proves the ordering: the payload stream is
    // never pulled from.
    stubUpstream(jsonResponse({ text: 'ok' }));
    const clip = multipart(Buffer.from('fake-audio-bytes'));
    let readBytes = 0;
    const counted = new Readable({
      read() {
        readBytes += clip.length;
        this.push(clip);
        this.push(null);
      },
    });

    const res = await post({
      payload: counted,
      headers: { 'content-length': String(clip.length) },
    });

    expect(res.statusCode).toBe(401);
    expect(readBytes).toBe(0);
  });

  it('rejects a caller without the operator role', async () => {
    // Transcription is part of the inspection an operator performs. A manager has no reason to
    // reach it, and operator is not a role other roles inherit (OHS s.257 competency).
    const fetchMock = stubUpstream(jsonResponse({ text: 'ok' }));

    const res = await post({ token: managerToken });

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body with no declared length before reading it', async () => {
    // A streamed payload carries no content-length. The AI Service answers 411 for the same reason:
    // measuring the body means reading it, which is what the size guard exists to avoid.
    const fetchMock = stubUpstream(jsonResponse({ text: 'ok' }));

    const res = await post({
      token: operatorToken,
      payload: Readable.from([multipart(Buffer.from('audio'))]),
    });

    expect(res.statusCode).toBe(411);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized clip on its declared length', async () => {
    const fetchMock = stubUpstream(jsonResponse({ text: 'ok' }));

    const res = await post({
      token: operatorToken,
      headers: { 'content-length': String(11 * 1024 * 1024) },
    });

    expect(res.statusCode).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'EMPTY_AUDIO_CLIP'],
    [413, 'AUDIO_CLIP_TOO_LARGE'],
    [429, 'TRANSCRIPTION_AT_CAPACITY'],
    [503, 'TRANSCRIPTION_UNAVAILABLE'],
  ])('passes an upstream %i through unchanged', async (status, code) => {
    // Each of these is a soft failure the PWA shows differently (busy, too long, unavailable).
    // Collapsing them into one status would leave the operator unable to tell retry from give up.
    stubUpstream(jsonResponse({ detail: 'nope' }, status));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ title: code, status });
  });

  it('drains the upstream body when the AI Service rejects the clip', async () => {
    // undici holds the socket until the body is consumed. 429 is the status that arrives in bursts
    // (the ADR 0017 cap is 2), so an undrained error body would leak a connection per rejected clip
    // exactly when the AI Service is busiest.
    const upstream = jsonResponse({ detail: 'at capacity' }, 429);
    stubUpstream(upstream);

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(429);
    expect(upstream.bodyUsed).toBe(true);
  });

  it('reports a 200 that is not JSON as a soft failure, not a server error', async () => {
    // A proxy error page in front of the AI Service makes json() reject. That must stay on the
    // soft-failure contract (type the note instead), not surface as core-api having broken.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 })),
    );

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ title: 'TRANSCRIPTION_FAILED' });
  });

  it('reports an unexpected upstream status as a bad gateway', async () => {
    stubUpstream(jsonResponse({ detail: 'boom' }, 500));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ title: 'TRANSCRIPTION_FAILED' });
  });

  it('reports an unreachable AI Service as a soft failure, not a server error', async () => {
    // The operator types the note instead. An inspection is never blocked by transcription.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ title: 'TRANSCRIPTION_UNAVAILABLE' });
  });

  it('rejects an upstream response that is not a transcript', async () => {
    stubUpstream(jsonResponse({ result: 'PASS' }));

    const res = await post({ token: operatorToken });

    expect(res.statusCode).toBe(502);
  });

  it('does not log the transcript text', async () => {
    // The transcript is the operator's spoken description of a defect and can carry PII.
    const { logger } = await import('../../lib/logger.js');
    const info = vi.spyOn(logger, 'info');
    stubUpstream(jsonResponse({ text: 'secret defect description' }));

    await post({ token: operatorToken });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('secret defect description');
    expect(logged).toContain('clipBytes');
  });
});

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../lib/config.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';

// The PWA reaches the AI Service through core-api, never directly (ADR 0019). The AI Service has
// no authentication of its own, and the audio it accepts is biometric PII under FOIP, so the
// operator's token is checked here and the AI Service stays on the internal network.

// Mirrors MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES in services/ai/transcription.py and
// services/ai/main.py. Kept in sync by hand: the two services are in different languages, and a
// shared constant would mean a build-time dependency between them for one number. The AI Service
// still enforces its own copy, so drift makes this gate stricter or laxer but never absent.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 4 * 1024;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES;

// The AI Service's budget is a 2s semaphore acquire plus a 30s inference timeout, after which it
// answers 503 itself. Wait slightly longer, so core-api does not abandon a request the AI Service
// is about to answer. A timeout here means the AI Service is wedged, not merely slow.
const UPSTREAM_TIMEOUT_MS = 35_000;

// The transcript text only. No pass/fail decision ever crosses this boundary (OHS s.257): the AI
// is assistive, and the operator reviews the text before it becomes part of an inspection.
const transcriptionSchema = z.object({ text: z.string() });

// Statuses the AI Service raises deliberately, each meaning "no transcript this time, type the note
// instead". They pass through unchanged so the PWA can tell the operator which one happened (busy,
// too long, unavailable) instead of failing blind.
const PASS_THROUGH_STATUS: Record<number, string> = {
  400: 'EMPTY_AUDIO_CLIP',
  413: 'AUDIO_CLIP_TOO_LARGE',
  429: 'TRANSCRIPTION_AT_CAPACITY',
  503: 'TRANSCRIPTION_UNAVAILABLE',
};

// Rejects a clip on its declared length, before Fastify reads the body. This has to run in
// onRequest: body parsing happens between onRequest and preHandler, so the same check in a
// preHandler would only see a clip that is already in memory. The AI Service puts its copy of this
// guard in middleware for the same reason.
const rejectOversizedClip = async (req: FastifyRequest): Promise<void> => {
  const declared = req.headers['content-length'];
  if (declared === undefined) {
    // Measuring an undeclared body means reading all of it, which is what this guard avoids. The
    // browser sets content-length itself for a FormData body, so the PWA always sends one.
    throw httpError(411, 'LENGTH_REQUIRED', 'Content-Length is required');
  }
  const length = Number(declared);
  if (!Number.isInteger(length) || length < 0) {
    throw httpError(400, 'INVALID_CONTENT_LENGTH', 'Content-Length is not a valid length');
  }
  if (length > MAX_REQUEST_BYTES) {
    throw httpError(413, 'AUDIO_CLIP_TOO_LARGE', 'Audio clip is too large');
  }
};

export const transcribeRoute: FastifyPluginAsync = async (app) => {
  // Hand the multipart body through untouched. Parsing it would rebuild the temp-file spool that
  // DEV-31 removed from the AI Service: audio is biometric PII under FOIP, so it stays in memory
  // and is forwarded as received. The explicit bodyLimit overrides Fastify's 1 MB default, which
  // would otherwise reject an ordinary voice note, and backstops a request that lies about its
  // content-length. The parser is registered inside this plugin, so it is scoped to this route and
  // does not change how any other route reads a body.
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: MAX_REQUEST_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post(
    '/ai/transcribe',
    {
      // Both hooks are onRequest, and the order is load-bearing. Fastify parses the body between
      // onRequest and preHandler, so an auth guard in preHandler would let an anonymous caller push
      // a 10 MB clip into memory before being told 401. Size first, then identity: a request that
      // reaches the parser is one core-api has already agreed to read. The ADR 0014 boot guard
      // accepts an auth hook in either position.
      onRequest: [rejectOversizedClip, requireRole('operator')],
      schema: { response: { 200: transcriptionSchema } },
    },
    async (req, reply) => {
      const aiServiceUrl = config().aiServiceUrl;
      if (!aiServiceUrl) {
        // config.ts requires this outside tests, so reaching here means core-api is misconfigured
        // rather than the model being down. The caller gets the same answer either way: type it.
        throw httpError(503, 'TRANSCRIPTION_UNAVAILABLE', 'Transcription is not available');
      }

      const contentType = req.headers['content-type'];
      if (contentType === undefined) {
        throw httpError(400, 'INVALID_CONTENT_TYPE', 'Content-Type is required');
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw httpError(400, 'EMPTY_AUDIO_CLIP', 'Audio clip is empty');
      }

      const startedAt = Date.now();
      let upstream: Response;
      try {
        upstream = await fetch(`${aiServiceUrl}/transcribe`, {
          method: 'POST',
          // Forward the content type with its multipart boundary. The operator's bearer token is
          // deliberately not forwarded: the AI Service does not authenticate, so passing the token
          // on would only widen where it can leak.
          headers: { 'content-type': contentType },
          // A sized body makes undici set content-length itself, which the AI Service requires (it
          // answers 411 without one). A stream body would be sent chunked and rejected there.
          //
          // The view is over the same memory, not a copy, so a 10 MB clip is not duplicated on its
          // way through. The cast is needed because a Buffer's backing store is typed ArrayBufferLike
          // (which admits SharedArrayBuffer) while fetch's BodyInit wants ArrayBuffer. Node never
          // backs a Buffer with a SharedArrayBuffer, so the narrowing holds.
          body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (err) {
        // Unreachable or wedged AI Service. Soft failure: the PWA keeps the note field typable and
        // the operator types instead, so transcription never blocks an inspection (ADR 0017).
        logger.warn(
          { reqId: req.id, userId: req.user.id, err, elapsedMs: Date.now() - startedAt },
          'transcription upstream unreachable',
        );
        throw httpError(503, 'TRANSCRIPTION_UNAVAILABLE', 'Transcription is not available');
      }

      const elapsedMs = Date.now() - startedAt;

      if (!upstream.ok) {
        const code = PASS_THROUGH_STATUS[upstream.status];
        logger.warn(
          { reqId: req.id, userId: req.user.id, upstreamStatus: upstream.status, elapsedMs },
          'transcription rejected by ai service',
        );
        // undici holds the socket open until the body is consumed. The error body is a detail
        // string nothing here reads, and the status that produces it most often is 429, which
        // arrives in bursts by definition (ADR 0017 caps concurrency at 2). Leaving it undrained
        // would leak a connection per rejected clip, exactly when the AI Service is busiest.
        await upstream.body?.cancel();
        if (code) {
          throw httpError(upstream.status, code, 'Transcription did not produce a transcript');
        }
        // Anything else is a fault in the AI Service, not a case it chose to signal.
        throw httpError(502, 'TRANSCRIPTION_FAILED', 'Transcription failed');
      }

      // A 200 that is not JSON at all (a proxy error page in front of the AI Service, say) makes
      // json() reject. Catching it keeps that case on the soft-failure contract: 502, type the note
      // instead. Letting it escape would surface as a 500, which says core-api broke.
      let payload: unknown;
      try {
        payload = await upstream.json();
      } catch {
        payload = undefined;
      }

      const parsed = transcriptionSchema.safeParse(payload);
      if (!parsed.success) {
        logger.error(
          { reqId: req.id, upstreamStatus: upstream.status },
          'transcription response did not match the expected shape',
        );
        throw httpError(502, 'TRANSCRIPTION_FAILED', 'Transcription failed');
      }

      // Size and timing only. The transcript is never logged: it is the operator's spoken
      // description of a defect and can carry PII (CLAUDE.md logging rules).
      logger.info(
        { reqId: req.id, userId: req.user.id, clipBytes: body.length, elapsedMs },
        'voice clip transcribed',
      );

      return reply.code(200).send(parsed.data);
    },
  );
};

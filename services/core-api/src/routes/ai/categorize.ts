import type { FastifyPluginAsync } from 'fastify';
import {
  categorizeNoteRequestSchema,
  categorizeNoteResponseSchema,
  type CategorizeNoteResponse,
} from '@mat-inspect/shared-schemas';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';

// The PWA reaches the AI Service through core-api, never directly (ADR 0019), the same reason
// transcribe.ts exists. Called only for a FAIL item's note (ADR 0028): the AI Service classifies
// text only, so this route (or its PWA caller) is where the pass/fail gate lives, not the model.
//
// Unlike transcribe.ts, every path here answers 200. The Advisory Check is assistive and
// dismissible (OHS s.257): a note that fails to categorize must never surface as an error the
// review screen has to handle specially, only as "no suggestion" (status: UNAVAILABLE). This
// mirrors assess_note's own fail-open contract one layer out, so an AI Service outage degrades
// the same way a slow one does.

// The AI Service's own budget is a 4s inference timeout (advisory.py DEFAULT_TIMEOUT_SECONDS)
// after which it still answers 200 with UNAVAILABLE. This only needs to outlast that by enough
// margin for network and JSON overhead; a timeout here means the AI Service is wedged, not
// merely slow at the model.
const UPSTREAM_TIMEOUT_MS = 6_000;

const UNAVAILABLE: CategorizeNoteResponse = { category: null, status: 'UNAVAILABLE' };

export const categorizeRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/ai/categorize',
    {
      preHandler: [requireRole('operator')],
      schema: {
        body: categorizeNoteRequestSchema,
        response: { 200: categorizeNoteResponseSchema },
      },
    },
    async (req, reply) => {
      const body = categorizeNoteRequestSchema.parse(req.body);

      const aiServiceUrl = config().aiServiceUrl;
      if (!aiServiceUrl) {
        // config.ts requires this outside tests, so reaching here means core-api is misconfigured
        // rather than the model being down. The caller gets the same answer either way.
        return reply.code(200).send(UNAVAILABLE);
      }

      const startedAt = Date.now();
      let upstream: Response;
      try {
        upstream = await fetch(`${aiServiceUrl}/advisory`, {
          method: 'POST',
          // The operator's bearer token is deliberately not forwarded: the AI Service does not
          // authenticate, so passing the token on would only widen where it can leak.
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note_text: body.noteText }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (err) {
        logger.warn(
          { reqId: req.id, userId: req.user.id, err, elapsedMs: Date.now() - startedAt },
          'categorize upstream unreachable',
        );
        return reply.code(200).send(UNAVAILABLE);
      }

      const elapsedMs = Date.now() - startedAt;

      if (!upstream.ok) {
        logger.warn(
          { reqId: req.id, userId: req.user.id, upstreamStatus: upstream.status, elapsedMs },
          'categorize rejected by ai service',
        );
        // undici holds the socket open until the body is consumed; nothing here reads the error
        // body, so drain it explicitly rather than leak the connection.
        await upstream.body?.cancel();
        return reply.code(200).send(UNAVAILABLE);
      }

      // A 200 that is not JSON at all (a proxy error page in front of the AI Service, say) makes
      // json() reject. Caught and folded into the same fail-open contract, not surfaced as a 500.
      let payload: unknown;
      try {
        payload = await upstream.json();
      } catch {
        payload = undefined;
      }

      const parsed = categorizeNoteResponseSchema.safeParse(payload);
      if (!parsed.success) {
        logger.error(
          { reqId: req.id, upstreamStatus: upstream.status },
          'categorize response did not match the expected shape',
        );
        return reply.code(200).send(UNAVAILABLE);
      }

      // The note text is never logged: it is the operator's description of a defect and can
      // carry PII (CLAUDE.md logging rules). category is not logged either, since it is derived
      // from the note text.
      logger.info(
        { reqId: req.id, userId: req.user.id, status: parsed.data.status, elapsedMs },
        'note categorized',
      );

      return reply.code(200).send(parsed.data);
    },
  );
};

import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { httpError } from '../lib/http-error.js';
import { config } from '../lib/config.js';

// Marks a preHandler as one that authenticates the request, mirroring the shared-auth-server
// convention so the fail-closed route guard (auth-route-guard.ts) can tell a public route from a
// forgotten one. Same symbol key as shared-auth-server and audit's ingest-auth.ts, by design.
export const AUTH_PREHANDLER: unique symbol = Symbol.for('mat-inspect.authPreHandler');

const markAuthPreHandler = <T extends object>(fn: T): T & { [AUTH_PREHANDLER]: true } =>
  Object.assign(fn, { [AUTH_PREHANDLER]: true as const });

// Service-to-service credential check, not human auth (no JWT, no roles): the only intended
// caller is the Audit Service's report generator, over the internal Docker network (DEV-38). It
// is the mirror image of audit's own requireIngestToken (services/audit/src/middleware/ingest-auth.ts)
// for the reverse direction. This endpoint answers with inspection responses, defect
// descriptions, and operator names, so it is not left to network isolation alone.
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export const requireInternalReportsToken = markAuthPreHandler(
  async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const expected = config().coreApiInternalToken;
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!provided || !expected || !safeEqual(provided, expected)) {
      throw httpError(401, 'MISSING_OR_INVALID_TOKEN', 'A valid bearer token is required');
    }
  },
);

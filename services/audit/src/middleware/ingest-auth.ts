import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { httpError } from '../lib/http-error.js';
import { config } from '../lib/config.js';

// Marks a preHandler as one that authenticates the request, mirroring core-api's
// AUTH_PREHANDLER convention so the fail-closed route guard below can tell a public route from a
// forgotten one.
export const AUTH_PREHANDLER: unique symbol = Symbol.for('mat-inspect.authPreHandler');

const markAuthPreHandler = <T extends object>(fn: T): T & { [AUTH_PREHANDLER]: true } =>
  Object.assign(fn, { [AUTH_PREHANDLER]: true as const });

// Service-to-service credential check, not human auth (no JWT, no roles): the only intended
// caller is core-api's outbox poller, over the internal Docker network. The endpoint this guards
// can mint legally-relevant audit rows, so it does not rely on network isolation alone (DEV-23).
// Constant-time comparison: a naive !== leaks timing information proportional to how many
// leading bytes match, which is a real (if narrow) attack surface for a bearer secret.
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export const requireIngestToken = markAuthPreHandler(
  async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const expected = config().auditIngestToken;
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!provided || !expected || !safeEqual(provided, expected)) {
      throw httpError(401, 'MISSING_OR_INVALID_TOKEN', 'A valid bearer token is required');
    }
  },
);

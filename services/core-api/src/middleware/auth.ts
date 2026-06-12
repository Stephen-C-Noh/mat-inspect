import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import type { UserRole } from '@mat-inspect/shared-types';
import { HttpError, httpError } from '../lib/http-error.js';
import { getJwks } from '../lib/jwks.js';
import { logger } from '../lib/logger.js';

export type AuthUser = {
  id: string; // Entra ID oid claim (stable object ID)
  email: string; // upn or preferred_username
  roles: UserRole[];
  tenantId: string; // tid claim
};

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

// Marks a preHandler as one that authenticates the request. The onRoute fail-closed
// guard (auth-route-guard.ts) reads this symbol to confirm every non-public route is
// gated. Symbol.for keeps the key stable across module instances.
export const AUTH_PREHANDLER: unique symbol = Symbol.for('mat-inspect.authPreHandler');

type RoutePreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type AuthPreHandler<T> = T & { [AUTH_PREHANDLER]: true };

const markAuthPreHandler = <T extends object>(fn: T): AuthPreHandler<T> =>
  Object.assign(fn, { [AUTH_PREHANDLER]: true as const });

const verifyTokenImpl = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw httpError(401, 'MISSING_TOKEN', 'Authorization header with Bearer token is required');
  }

  const token = header.slice(7);

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      ...(process.env['ENTRA_TENANT_ID'] && {
        issuer: `https://login.microsoftonline.com/${process.env['ENTRA_TENANT_ID']}/v2.0`,
      }),
      ...(process.env['ENTRA_CLIENT_ID'] && {
        audience: process.env['ENTRA_CLIENT_ID'],
      }),
    });

    // oid is the stable object ID in Entra ID; fall back to sub for dev tokens
    const oid = payload['oid'] ?? payload['sub'];
    if (typeof oid !== 'string') {
      throw httpError(401, 'INVALID_TOKEN', 'Token is missing user identifier');
    }

    req.user = {
      id: oid,
      email: String(payload['upn'] ?? payload['preferred_username'] ?? ''),
      roles: Array.isArray(payload['roles']) ? (payload['roles'] as UserRole[]) : [],
      tenantId: String(payload['tid'] ?? ''),
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn({ err }, 'JWT verification failed');
    throw httpError(401, 'INVALID_TOKEN', 'Token is invalid or expired');
  }
};

export const verifyToken = markAuthPreHandler(verifyTokenImpl);

// Returns a Fastify preHandler that first calls verifyToken, then checks the role.
// Usage: preHandler: [requireRole('operator')]
// Multi-role (any of): preHandler: [requireRole('operator', 'manager')]
export const requireRole = (...roles: UserRole[]): AuthPreHandler<RoutePreHandler> =>
  markAuthPreHandler<RoutePreHandler>(async (req, reply) => {
    await verifyToken(req, reply);
    if (!roles.some((r) => req.user.roles.includes(r))) {
      throw httpError(403, 'FORBIDDEN', `One of these roles is required: ${roles.join(', ')}`);
    }
  });

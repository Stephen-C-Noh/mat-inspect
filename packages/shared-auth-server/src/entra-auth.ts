import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { UserRole } from '@mat-inspect/shared-types';

// The one implementation of Entra access-token verification. Services build a preHandler from
// it and register their own route guard; nothing else about auth is per service (ADR 0002,
// ADR 0012, ADR 0014).

export type AuthUser = {
  id: string; // Entra ID oid claim (stable object ID)
  email: string; // upn or preferred_username
  name: string; // name claim (human display name); '' when the token omits it
  roles: UserRole[];
  tenantId: string; // tid claim
};

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

// Marks a preHandler as one that authenticates the request. Each service's fail-closed onRoute
// guard reads this symbol to confirm every non-public route is gated (ADR 0014). Symbol.for
// keeps the key stable across module instances.
export const AUTH_PREHANDLER: unique symbol = Symbol.for('mat-inspect.authPreHandler');

export type RoutePreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

// The marker is a runtime property, not a type brand. The guard reads it off the function at
// route registration; a branded type would have to be named in every consuming service's emitted
// declarations, which TypeScript cannot do across packages (TS4023).
const markAuthPreHandler = (fn: RoutePreHandler): RoutePreHandler =>
  Object.assign(fn, { [AUTH_PREHANDLER]: true as const });

export type EntraAuthDeps = {
  // The service's own RFC 7807 error factory, so failures render like every other error it
  // raises. The package does not carry an error type of its own.
  httpError: (status: number, code: string, detail: string) => Error;
  logger: { warn: (obj: object, msg: string) => void };
};

export type EntraAuth = {
  verifyToken: RoutePreHandler;
  requireRole: (...roles: UserRole[]) => RoutePreHandler;
  // Test seams. setJwksForTest injects a local key set so tests neither mock this module nor
  // reach the network (CLAUDE.md: mock external services only).
  setJwksForTest: (jwks: JWTVerifyGetKey) => void;
  resetJwksForTest: () => void;
};

export const createEntraAuth = ({ httpError, logger }: EntraAuthDeps): EntraAuth => {
  let jwks: JWTVerifyGetKey | null = null;

  const resolveJwksUri = (): string => {
    const tenantId = process.env['ENTRA_TENANT_ID'];
    if (!tenantId) {
      // Each service validates ENTRA_TENANT_ID at boot (ADR 0015), so it is only ever blank
      // under NODE_ENV=test, where setJwksForTest injects a local key set and this resolver is
      // never reached. Reaching here with a blank tenant is a genuine misconfiguration; fail
      // loudly rather than fetch keys from a host that does not exist. The dev-token fallback
      // that once resolved to core-api's /dev/jwks was removed with the dev token (DEV-61,
      // ADR 0021).
      throw new Error('ENTRA_TENANT_ID is required to resolve the Entra JWKS URI');
    }
    return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  };

  const getJwks = (): JWTVerifyGetKey => {
    jwks ??= createRemoteJWKSet(new URL(resolveJwksUri()));
    return jwks;
  };

  const verifyTokenImpl = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw httpError(401, 'MISSING_TOKEN', 'Authorization header with Bearer token is required');
    }

    const token = header.slice(7);

    let payload;
    try {
      // ENTRA_* are read live (not from a cached config) so tests can toggle them per case.
      // Each service validates them at boot: in dev and production both are required and a
      // placeholder is rejected (ADR 0015). They are blank only under NODE_ENV=test, where the
      // issuer and audience checks are skipped and setJwksForTest supplies the key set.
      ({ payload } = await jwtVerify(token, getJwks(), {
        ...(process.env['ENTRA_TENANT_ID'] && {
          issuer: `https://login.microsoftonline.com/${process.env['ENTRA_TENANT_ID']}/v2.0`,
        }),
        ...(process.env['ENTRA_CLIENT_ID'] && {
          audience: process.env['ENTRA_CLIENT_ID'],
        }),
      }));
    } catch (err) {
      logger.warn({ err }, 'JWT verification failed');
      throw httpError(401, 'INVALID_TOKEN', 'Token is invalid or expired');
    }

    // oid is the stable object ID in Entra ID; fall back to sub for dev tokens.
    const oid = payload['oid'] ?? payload['sub'];
    if (typeof oid !== 'string') {
      throw httpError(401, 'INVALID_TOKEN', 'Token is missing user identifier');
    }

    req.user = {
      id: oid,
      email: String(payload['upn'] ?? payload['preferred_username'] ?? ''),
      // `name` is an optional Entra claim (must be enabled on the app registration). When present
      // it is the human display name; core-api records it into the users shadow table so an
      // inspection identifies the operator by name, not by an email or an oid (OHS s.257).
      name: String(payload['name'] ?? ''),
      roles: Array.isArray(payload['roles']) ? (payload['roles'] as UserRole[]) : [],
      tenantId: String(payload['tid'] ?? ''),
    };
  };

  const verifyToken = markAuthPreHandler(verifyTokenImpl);

  // Returns a Fastify preHandler that first verifies the token, then checks the role.
  // Usage: preHandler: [requireRole('operator')]
  // Multi-role (any of): preHandler: [requireRole('operator', 'manager')]
  const requireRole = (...roles: UserRole[]): RoutePreHandler =>
    markAuthPreHandler(async (req, reply) => {
      await verifyToken(req, reply);
      if (!roles.some((r) => req.user.roles.includes(r))) {
        throw httpError(403, 'FORBIDDEN', `One of these roles is required: ${roles.join(', ')}`);
      }
    });

  return {
    verifyToken,
    requireRole,
    setJwksForTest: (local: JWTVerifyGetKey): void => {
      jwks = local;
    },
    resetJwksForTest: (): void => {
      jwks = null;
    },
  };
};

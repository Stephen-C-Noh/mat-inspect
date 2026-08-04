import {
  AUTH_PREHANDLER,
  createEntraAuth,
  type RoutePreHandler,
} from '@mat-inspect/shared-auth-server';
import { httpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
import { ensureUserProvisioned } from '../lib/user-provisioning.js';

// Entra token verification lives in @mat-inspect/shared-auth-server, so core-api and media
// cannot drift apart on the issuer check, the audience check or the key cache (DEV-98). This
// file only binds the service's error factory and logger to it.
const auth = createEntraAuth({ httpError, logger });

// Just-in-time provisioning runs here, at the one place every authenticated route passes through,
// so no route has to remember it (DEV-124). It runs only after the wrapped hook resolves, i.e. the
// token verified and any role check passed, so an unauthenticated or wrong-role request never
// provisions. The wrapper re-carries the AUTH_PREHANDLER marker (a global-registry symbol) so the
// fail-closed route guard still recognizes the route as authenticated.
const withProvisioning = (hook: RoutePreHandler): RoutePreHandler => {
  const wrapped: RoutePreHandler = async (req, reply) => {
    await hook(req, reply);
    await ensureUserProvisioned(req.user);
  };
  return Object.assign(wrapped, { [AUTH_PREHANDLER]: true as const });
};

export const verifyToken = withProvisioning(auth.verifyToken);
export const requireRole = (...roles: Parameters<typeof auth.requireRole>): RoutePreHandler =>
  withProvisioning(auth.requireRole(...roles));
export const { setJwksForTest, resetJwksForTest } = auth;

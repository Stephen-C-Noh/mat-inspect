import type { FastifyInstance } from 'fastify';
import { ROLE_GUARD } from './auth.js';

// Routes that intentionally carry no role guard. /health is an unauthenticated
// liveness probe; the /dev/* routes are only registered outside production.
export const PUBLIC_ROUTES = new Set(['/health', '/dev/jwks', '/dev/token']);

const hasRoleGuard = (preHandler: unknown): boolean => {
  const handlers = Array.isArray(preHandler) ? preHandler : preHandler ? [preHandler] : [];
  return handlers.some(
    (h): boolean => typeof h === 'function' && (h as Record<symbol, unknown>)[ROLE_GUARD] === true,
  );
};

// ADR 0014: fail closed at boot. Registers an onRoute hook that throws if a route
// declares no role guard and is not in the public allowlist. The throw crashes
// registration, so a misgated route never reaches a running deployment. This is
// stronger than a per-request 403, which only protects routes someone remembered
// to gate.
export const enforceRoleGating = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: FastifyInstance<any, any, any, any, any>,
  opts: { publicRoutes?: Set<string> } = {},
): void => {
  const publicRoutes = opts.publicRoutes ?? PUBLIC_ROUTES;
  app.addHook('onRoute', (routeOptions) => {
    if (publicRoutes.has(routeOptions.url)) return;
    if (hasRoleGuard(routeOptions.preHandler)) return;
    throw new Error(
      `Route ${routeOptions.method} ${routeOptions.url} declares no role guard and is not in the public allowlist (ADR 0014). ` +
        `Add a requireRole(...) preHandler or add the path to PUBLIC_ROUTES.`,
    );
  });
};

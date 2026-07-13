import type { FastifyInstance } from 'fastify';
import { AUTH_PREHANDLER } from './auth.js';

// Routes that intentionally carry no auth preHandler. Kept explicit so the fail-closed
// guard can tell a public route from a forgotten one. /health is the liveness probe; the
// /dev/* routes are the dev-only JWKS and token issuer (registered only outside production).
export const PUBLIC_ROUTES: readonly string[] = ['/health', '/dev/jwks', '/dev/token'];

const isAuthPreHandler = (handler: unknown): boolean =>
  typeof handler === 'function' &&
  (handler as unknown as Record<symbol, unknown>)[AUTH_PREHANDLER] === true;

// Registers an onRoute hook that fails the boot if a route has no auth hook and is not in
// the public allowlist. Authorization is declared per route via requireRole (CLAUDE.md
// Auth); this turns "forgot to declare a role" from a silent open endpoint into a startup
// crash. The check runs at registration, so a misgated route never ships.
//
// preHandler is the usual place. onRequest counts too, and a route that takes a large body
// must use it: Fastify parses the body between onRequest and preHandler, so a preHandler
// guard admits an unauthenticated body into memory before rejecting it (see
// routes/ai/transcribe.ts).
export const registerAuthRouteGuard = <
  App extends FastifyInstance<any, any, any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  app: App,
  opts: { publicRoutes?: readonly string[] } = {},
): void => {
  const publicRoutes = new Set(opts.publicRoutes ?? PUBLIC_ROUTES);

  app.addHook('onRoute', (route) => {
    if (publicRoutes.has(route.url)) return;

    const handlers = [route.preHandler ?? [], route.onRequest ?? []].flat();
    if (!handlers.some(isAuthPreHandler)) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} has no auth hook and is not in the ` +
          `public allowlist. Declare a role with requireRole(...) in preHandler or onRequest, ` +
          `or add it to PUBLIC_ROUTES (fail-closed, ADR 0014).`,
      );
    }
  });
};

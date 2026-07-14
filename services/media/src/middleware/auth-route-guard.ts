import type { FastifyInstance } from 'fastify';
import { AUTH_PREHANDLER } from '@mat-inspect/shared-auth-server';

// /health is the liveness probe, intentionally public. Every other route must declare an auth
// preHandler (requireRole) or the boot crashes (fail-closed, ADR 0014; mirrors core-api and audit).
export const PUBLIC_ROUTES: readonly string[] = ['/health'];

const isAuthPreHandler = (handler: unknown): boolean =>
  typeof handler === 'function' &&
  (handler as unknown as Record<symbol, unknown>)[AUTH_PREHANDLER] === true;

// Registers an onRoute hook that fails the boot if a route has no auth preHandler and is not in
// the public allowlist. The check runs at route registration, so a route that forgets its role
// declaration never ships as a silently open endpoint.
export const registerAuthRouteGuard = <
  App extends FastifyInstance<any, any, any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  app: App,
  opts: { publicRoutes?: readonly string[] } = {},
): void => {
  const publicRoutes = new Set(opts.publicRoutes ?? PUBLIC_ROUTES);

  app.addHook('onRoute', (route) => {
    if (publicRoutes.has(route.url)) return;

    const handlers = [route.preHandler ?? []].flat();
    if (!handlers.some(isAuthPreHandler)) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} has no auth preHandler and is not in the ` +
          `public allowlist. Declare a role with requireRole(...) or add it to PUBLIC_ROUTES ` +
          `(fail-closed, ADR 0014).`,
      );
    }
  });
};

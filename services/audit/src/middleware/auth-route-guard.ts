import type { FastifyInstance } from 'fastify';
import { AUTH_PREHANDLER } from './ingest-auth.js';

// /health is the liveness probe, intentionally public. Every other route must declare
// requireIngestToken or boot crashes (mirrors core-api's auth-route-guard.ts, ADR 0014).
export const PUBLIC_ROUTES: readonly string[] = ['/health'];

const isAuthPreHandler = (handler: unknown): boolean =>
  typeof handler === 'function' &&
  (handler as unknown as Record<symbol, unknown>)[AUTH_PREHANDLER] === true;

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
          `public allowlist. Declare requireIngestToken or add it to PUBLIC_ROUTES (fail-closed, ADR 0014).`,
      );
    }
  });
};

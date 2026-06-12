import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAuthRouteGuard } from './auth-route-guard.js';
import { verifyToken, requireRole } from './auth.js';

describe('auth route guard (fail-closed)', () => {
  it('throws at boot when a route declares no auth preHandler and is not public', async () => {
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() => app.get('/secrets', async () => ({ ok: true }))).toThrow(/auth preHandler/);
  });

  it('allows a route gated with requireRole', () => {
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() =>
      app.get('/equipment', { preHandler: [requireRole('operator')] }, async () => ({ ok: true })),
    ).not.toThrow();
  });

  it('allows a route gated with bare verifyToken', () => {
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() =>
      app.get('/me', { preHandler: [verifyToken] }, async () => ({ ok: true })),
    ).not.toThrow();
  });

  it('allows a public route that declares no auth preHandler', () => {
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() => app.get('/health', async () => ({ status: 'ok' }))).not.toThrow();
  });
});

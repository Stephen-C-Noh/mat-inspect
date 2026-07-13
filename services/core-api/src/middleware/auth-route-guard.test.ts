import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAuthRouteGuard } from './auth-route-guard.js';
import { verifyToken, requireRole } from './auth.js';

describe('auth route guard (fail-closed)', () => {
  it('throws at boot when a route declares no auth hook and is not public', async () => {
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() => app.get('/secrets', async () => ({ ok: true }))).toThrow(/no auth hook/);
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

  it('allows a route gated with requireRole in onRequest', () => {
    // A route that takes a large body must authenticate in onRequest: Fastify parses the body
    // between onRequest and preHandler, so a preHandler guard reads an anonymous caller's body
    // into memory before rejecting it (routes/ai/transcribe.ts).
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() =>
      app.post('/ai/transcribe', { onRequest: [requireRole('operator')] }, async () => ({
        ok: true,
      })),
    ).not.toThrow();
  });

  it('throws when a route declares a non-auth onRequest hook only', () => {
    // A hook in the right position is not the same as an auth hook. Only handlers carrying the
    // AUTH_PREHANDLER marker satisfy the guard.
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() =>
      app.post('/ai/transcribe', { onRequest: [async () => {}] }, async () => ({ ok: true })),
    ).toThrow(/no auth hook/);
  });

  it('allows a public route that declares no auth preHandler', () => {
    const app = Fastify();
    registerAuthRouteGuard(app);

    expect(() => app.get('/health', async () => ({ status: 'ok' }))).not.toThrow();
  });
});

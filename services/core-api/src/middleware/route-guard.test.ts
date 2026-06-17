import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { enforceRoleGating } from './route-guard.js';
import { requireRole } from './auth.js';

// ADR 0014: fail closed at boot. A route that declares no role and is not in the
// public allowlist must crash registration, so a misgated route never ships.
describe('enforceRoleGating (ADR 0014 boot guard)', () => {
  // Boots a Fastify app with the guard installed, then registers the caller's routes.
  // Mirrors buildApp: the guard is added before routes, so a bad route crashes boot.
  const boot = async (register: (app: ReturnType<typeof Fastify>) => void) => {
    const app = Fastify();
    enforceRoleGating(app);
    register(app);
    await app.ready();
    return app;
  };

  it('throws at boot for a route that declares no role and is not public', async () => {
    await expect(
      boot((app) => {
        app.get('/secret', async () => ({ ok: true }));
      }),
    ).rejects.toThrow(/\/secret/);
  });

  it('boots a route that declares a role via requireRole', async () => {
    const app = await boot((instance) => {
      instance.get('/gated', { preHandler: [requireRole('admin')] }, async () => ({ ok: true }));
    });
    await app.close();
  });

  it('boots a public allowlist route that declares no role', async () => {
    const app = await boot((instance) => {
      instance.get('/health', async () => ({ status: 'ok' }));
    });
    await app.close();
  });
});

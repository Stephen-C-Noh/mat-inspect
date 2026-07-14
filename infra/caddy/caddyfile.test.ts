import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the routing table (ADR 0020). This checks the spelling of the config, which is weaker than
// the deploy smoke check that a request without a token answers 401, but it fails in the pull
// request instead of after the deploy.
const source = readFileSync(fileURLToPath(new URL('./Caddyfile', import.meta.url)), 'utf8');

// Directives only. The comments in the file name ai:8000 to say the route must not exist, and a
// naive search for the string would match the warning as readily as the mistake.
const caddyfile = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('Caddyfile', () => {
  it('declares no route to the AI Service', () => {
    // The AI Service has no authentication of its own and the audio it accepts is biometric PII
    // under FOIP. The browser reaches it through core-api, which authenticates the operator
    // (ADR 0019). A reverse_proxy to it here would be an unauthenticated path to the model.
    expect(caddyfile).not.toMatch(/reverse_proxy\s+ai:/);
    expect(caddyfile).not.toContain('ai:8000');
  });

  it('routes the media prefix to media and everything else under /api/v1 to core-api', () => {
    expect(caddyfile).toMatch(/@media path \/api\/v1\/media\/\*/);
    expect(caddyfile).toMatch(/reverse_proxy\s+media:3000/);
    expect(caddyfile).toMatch(/handle \/api\/v1\/\*\s*\{\s*reverse_proxy\s+core-api:3000/);
  });

  it('keeps the API routing table in one snippet that every site imports', () => {
    // Two sites serve the API (the PWA's origin and the dashboard's). If a site block spelled the
    // upstreams out itself, the two origins could drift apart on where a path goes.
    const siteImports = caddyfile.match(/^\timport api$/gm) ?? [];
    expect(siteImports.length).toBeGreaterThanOrEqual(3);
    expect(caddyfile.match(/reverse_proxy\s+core-api:3000/g)).toHaveLength(2); // api snippet + /dev/*
  });

  it('serves the apps from the gateway rather than a published container port', () => {
    expect(caddyfile).toMatch(/reverse_proxy\s+pwa:3000/);
    expect(caddyfile).toMatch(/reverse_proxy\s+dashboard:3000/);
  });

  it('answers its own liveness from a handle, not a bare respond', () => {
    // Each site ends in a catch-all `handle` for its app, and that takes the request before a bare
    // `respond` runs. A `respond /health 200` here was answered by the PWA's own /health page, and
    // on the dashboard's origin, which has no such page, it 404d. The healthcheck and the deploy
    // smoke check both hit this path, so it has to be the gateway that answers it.
    expect(caddyfile).toMatch(/handle \/gateway\/health\s*\{\s*respond "ok" 200/);
    expect(caddyfile).not.toMatch(/^\s*respond \/health/m);
  });

  it('exposes the dev-token issuer on the dev listener only', () => {
    // /dev/* is core-api's dev-only token and JWKS scaffolding (DEV-7). It must not be reachable
    // from a site a browser can open.
    const devListener = caddyfile.slice(caddyfile.indexOf(':8080 {'));
    expect(devListener).toMatch(/handle \/dev\/\*/);
    expect(caddyfile.slice(0, caddyfile.indexOf(':8080 {'))).not.toContain('/dev/*');
  });
});

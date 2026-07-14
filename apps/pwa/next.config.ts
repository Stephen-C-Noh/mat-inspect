import path from 'path';
import type { NextConfig } from 'next';

// The API destination is the gateway, never a service (ADR 0020). Which service owns a path is
// decided in infra/caddy/Caddyfile, in one place. Pointing this at core-api is what made
// /api/v1/ai/* and /api/v1/media/* 404 (DEV-34, DEV-85).
//
// In Compose the browser talks to Caddy directly, so this rewrite is not on the request path. It
// carries `npm run dev`, where the app runs outside Compose: the dev server proxies /api/v1 to the
// gateway's loopback dev listener, so a path resolves in dev exactly as it does in staging.
const gatewayUrl = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Hide the Next.js dev indicator (the "N" overlay button) so it does not cover the
  // fixed submit button during local checklist review. Dev-only; no effect on builds.
  devIndicators: false,

  async rewrites() {
    const rewrites = [
      {
        source: '/api/v1/:path*',
        destination: `${gatewayUrl}/api/v1/:path*`,
      },
    ];

    // The /dev/token issuer is dev-only scaffolding (DEV-7). The gateway serves /dev/* on the dev
    // listener alone, never on a site a browser can open, so a deployed PWA has no path to it. The
    // production guard here stays as a second lock.
    if (process.env.NODE_ENV !== 'production') {
      rewrites.push({
        source: '/dev/:path*',
        destination: `${gatewayUrl}/dev/:path*`,
      });
    }

    return rewrites;
  },
};

export default nextConfig;

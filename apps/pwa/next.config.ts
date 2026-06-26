import path from 'path';
import type { NextConfig } from 'next';

const coreApiUrl = process.env.CORE_API_URL ?? 'http://127.0.0.1:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Hide the Next.js dev indicator (the "N" overlay button) so it does not cover the
  // fixed submit button during local checklist review. Dev-only; no effect on builds.
  devIndicators: false,

  // Proxy API requests to the core-api service to avoid CORS issue and allow local development against the backend services. Destination is configurable via CORE_API_URL so compose can inject the in-cluster address.
  async rewrites() {
    const rewrites = [
      {
        source: '/api/v1/:path*',
        destination: `${coreApiUrl}/api/v1/:path*`,
      },
    ];

    // The /dev/token issuer is dev-only scaffolding (DEV-7). Do not proxy it in
    // production builds so the dev auth path cannot leak into a deployed PWA.
    if (process.env.NODE_ENV !== 'production') {
      rewrites.push({
        source: '/dev/:path*',
        destination: `${coreApiUrl}/dev/:path*`,
      });
    }

    return rewrites;
  },
};

export default nextConfig;

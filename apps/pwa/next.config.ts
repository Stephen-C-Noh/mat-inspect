import path from 'path';
import type { NextConfig } from 'next';

const coreApiUrl = process.env.CORE_API_URL ?? 'http://127.0.0.1:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Proxy API requests to the core-api service to avoid CORS issue and allow local development against the backend services. Destination is configurable via CORE_API_URL so compose can inject the in-cluster address.
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${coreApiUrl}/api/v1/:path*`,
      },
      {
        source: '/dev/:path*',
        destination: `${coreApiUrl}/dev/:path*`,
      },
    ];
  },
};

export default nextConfig;

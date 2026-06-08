import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Proxy API requests to the core-api service to avoid CORS issue and allow local development against the backend services.
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:3000/api/v1/:path*',
      },
      {
        source: '/dev/:path*',
        destination: 'http://127.0.0.1:3000/dev/:path*',
      },
    ];
  },
};

export default nextConfig;

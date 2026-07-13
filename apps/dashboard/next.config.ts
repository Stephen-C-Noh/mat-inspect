import path from 'path';
import type { NextConfig } from 'next';

// Same rule as the PWA (ADR 0020): the API destination is the gateway, never a service. The
// dashboard makes no API call yet, so this rewrite carries no traffic today. It is written now so
// that the first call (DEV-38 reports) starts on the routing table rather than around it, which is
// how the PWA's rewrite came to disagree with the gateway in the first place.
const gatewayUrl = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${gatewayUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

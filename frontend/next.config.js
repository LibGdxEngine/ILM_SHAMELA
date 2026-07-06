/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Preserve trailing slashes so proxied /api/*/ requests keep the slash Django requires
  skipTrailingSlashRedirect: true,
  // Only use standalone output in production builds
  ...(process.env.NODE_ENV === 'production' && { output: 'standalone' }),
  experimental: {
    // Bodies proxied through the middleware pipeline are buffered and
    // truncated at 10MB by default, which silently corrupted large document
    // uploads (PDF + OCR layout JSON). Backend allows 100MB docs + 50MB OCR
    // layouts, so give the proxy matching headroom.
    proxyClientMaxBodySize: '160mb',
  },
  /**
   * In Docker-based development, the frontend dev server runs on port 3000,
   * while the Django backend is exposed as the `backend` service on port 8000.
   *
   * These rewrites make any request to `/api/*` on the Next.js dev server
   * get proxied to the Django backend, so that calling
   *   http://localhost:3000/api/...
   * works correctly.
   *
   * The proxy target is configurable via BACKEND_PROXY_URL so the frontend can
   * also run on the host (where the Docker service hostname `backend` does not
   * resolve) by pointing at http://localhost:8000. Defaults to the Docker
   * service hostname to preserve in-network behavior.
   */
  async rewrites() {
    const backendUrl = process.env.BACKEND_PROXY_URL || 'http://backend:8000';
    return [
      {
        // Proxy every /api/* route to Django EXCEPT the exact /api/copilotkit
        // segment, which is a local App Router handler (the CopilotKit runtime
        // bridge). The `(?:/|$)` boundary keeps the lookahead from also blocking
        // real Django paths that merely start with "copilotkit"
        // (e.g. /api/copilotkit-status/).
        source: '/api/:path((?!copilotkit(?:/|$)).*)',
        destination: `${backendUrl}/api/:path`,
      },
      {
        source: '/media/:path*',
        destination: `${backendUrl}/media/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/media/**',
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '8000',
        pathname: '/media/**',
      },
      {
        protocol: 'http',
        hostname: 'backend',
        port: '8000',
        pathname: '/media/**',
      },
    ],
  },
};

module.exports = nextConfig;

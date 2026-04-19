/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Preserve trailing slashes so proxied /api/*/ requests keep the slash Django requires
  skipTrailingSlashRedirect: true,
  // Only use standalone output in production builds
  ...(process.env.NODE_ENV === 'production' && { output: 'standalone' }),
  /**
   * In Docker-based development, the frontend dev server runs on port 3000,
   * while the Django backend is exposed as the `backend` service on port 8000.
   *
   * These rewrites make any request to `/api/*` on the Next.js dev server
   * get proxied to the Django backend, so that calling
   *   http://localhost:3000/api/...
   * works correctly.
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://backend:8000/api/:path*',
      },
      {
        source: '/media/:path*',
        destination: 'http://backend:8000/media/:path*',
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

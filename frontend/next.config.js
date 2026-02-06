/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    ];
  },
};

module.exports = nextConfig;

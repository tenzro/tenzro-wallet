import type { NextConfig } from 'next';

/**
 * Next.js 16 config — App Router. `@tenzro/ui` resolves through its
 * package `exports` to the built `dist/`; turbo's `^build` dependency
 * guarantees the UI package is compiled before the app builds, so apps
 * consume the same artifact external `npm install @tenzro/ui` consumers
 * get. `transpilePackages` lets SWC re-process the shipped TSX +
 * sourcemaps for a clean dev/debug experience.
 *
 * Headers tighten the wallet against clickjacking + MIME sniffing.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tenzro/ui', 'tenzro-wallet'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion', '@tenzro/ui'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

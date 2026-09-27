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
 *
 * `TENZRO_STATIC_EXPORT=1` builds a static site (`out/`): every page runs in
 * the browser, so the hosted wallet needs no server. A static host ignores
 * `headers()`, so it must send the same headers itself.
 */
const staticExport = process.env.TENZRO_STATIC_EXPORT === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(staticExport ? { output: 'export' as const } : {}),
  transpilePackages: ['@tenzro/ui', 'tenzro-wallet'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion', '@tenzro/ui'],
  },
  ...(staticExport ? {} : { headers }),
};

async function headers() {
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
}

export default nextConfig;

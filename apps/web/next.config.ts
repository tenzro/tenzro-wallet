import type { NextConfig } from 'next';

/**
 * Next.js 16 config — App Router, transpiles the workspace UI package
 * so its TSX is compiled by SWC instead of being shipped pre-built.
 *
 * Headers tighten the wallet against clickjacking + MIME sniffing.
 * `dangerouslyAllowSVG: false` keeps SVG imports from arbitrary
 * sources from being rendered as raster — wallets are a phishing
 * target and a misrendered SVG can hide a domain swap.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tenzro/ui', '@tenzro/wallet-kernel'],
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

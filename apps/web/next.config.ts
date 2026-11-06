import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * The wallet is a static site: every page runs in the browser, so any
 * provider can serve it from any static host. The host sends the security
 * headers (see the README); a static export ignores `headers()`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: false,
  transpilePackages: ['@tenzro/ui'],
  // tenzro-sdk is linked from the checkout beside this repository.
  turbopack: { root: fileURLToPath(new URL('../../..', import.meta.url)) },
};

export default nextConfig;

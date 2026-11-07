import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the built wallet (apps/web/out) in Chromium with a
 * CDP virtual authenticator, against a local Tenzro dev node.
 *
 *   WALLET_E2E_RPC   JSON-RPC of the dev node (default http://127.0.0.1:8545)
 *   WALLET_E2E_CHAIN chain id the build was made for (default 13380)
 *   CHROMIUM         path to a Chromium binary, if Playwright's own is absent
 *
 * Build first:
 *   NEXT_PUBLIC_WALLET_RP_ID=localhost NEXT_PUBLIC_WALLET_SEEDS=$WALLET_E2E_RPC \
 *   NEXT_PUBLIC_WALLET_CHAIN_ID=$WALLET_E2E_CHAIN pnpm --filter @tenzro/web build
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 300_000,
  workers: 1,
  retries: 1, // a solo node's block timing can lag a step by a block
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../../test-results',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node serve.mjs 4173 127.0.0.1',
    cwd: '.',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
  },
});

import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the built wallet (apps/web/out) in Chromium with a
 * CDP virtual authenticator, against a local Tenzro dev node.
 *
 *   WALLET_E2E_RPC   JSON-RPC of the dev node (default http://127.0.0.1:8545)
 *   WALLET_E2E_CHAIN chain id the build was made for (default 13380)
 *   CHROMIUM         path to a Chromium binary, if Playwright's own is absent
 *
 * Build first, with two routes to the node (the devices and recovery specs
 * need a second node for the approval check):
 *   tests/e2e/build.sh
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 300_000,
  workers: 1,
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

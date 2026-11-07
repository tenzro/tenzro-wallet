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
 *   NEXT_PUBLIC_WALLET_SECOND_RPC=$WALLET_E2E_RPC \
 *   NEXT_PUBLIC_WALLET_CHAIN_ID=$WALLET_E2E_CHAIN pnpm --filter @tenzro/web build
 *
 * NEXT_PUBLIC_WALLET_SECOND_RPC is required here: a solo dev node has no
 * second operator for `pickSecond()` (lib/network.ts) to find, and every
 * approval flow (`checkedEffects`, lib/effects.ts) refuses outright with no
 * second node -- "No second node is available to check what this does, so
 * it cannot be approved." That's deliberate production safety, not a bug:
 * never approve a transaction without an independently-operated node
 * re-deriving its effects. Pointing SECOND_RPC at the SAME solo node here
 * only exercises the approval code path for devices.spec/recovery.spec; it
 * does NOT test the "two nodes disagree" case, and must NEVER be done this
 * way in scripts/deploy.sh (production) -- there, leave SECOND_RPC unset so
 * `pickSecond()` keeps picking a real, independently-operated endpoint from
 * the live network's own discovered operator list.
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

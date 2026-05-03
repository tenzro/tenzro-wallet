/**
 * Testnet smoke test — env-gated. Skipped in CI by default; run locally
 * with valid Tenzro testnet auth to confirm the SDK adapter actually works
 * end-to-end against a live node.
 *
 * Required env:
 *   - TENZRO_BEARER_JWT — DPoP-bound JWT issued by Tenzro auth.
 *   - TENZRO_DPOP_PROOF — fresh DPoP proof for the request (read by the SDK
 *     RpcClient automatically; we just need it set in the environment).
 *   - TENZRO_TEST_ADDRESS — the address that owns the JWT, used as both
 *     `from` and `to` for a 1-wei self-transfer.
 *
 * Optional env:
 *   - TENZRO_TEST_TIMEOUT_MS — how long to wait for finalization. Default 60s.
 *
 * What it does:
 *   1. Construct `TenzroClient.testnet()` and wrap with `TenzroSdkAdapter`.
 *   2. Probe `getChainId()` to confirm transport works (cheapest call).
 *   3. Read the current nonce — confirms auth resolves to a real account.
 *   4. Send a 1-wei self-transfer (smallest legal TNZO move).
 *   5. Poll `getTransaction(hash)` until status transitions to `'finalized'`.
 *
 * Each network call is its own assertion so a transport break (step 2),
 * an auth break (step 3), or a submission break (step 4) all surface at
 * the right line.
 */

import { describe, expect, it } from 'vitest';
import { TenzroClient } from 'tenzro-sdk';
import { TenzroSdkAdapter } from '../ports/adapters/tenzro-sdk-adapter.ts';

// Read env via globalThis cast — kernel package is browser-clean and has no
// @types/node, so `process` isn't a known global at typecheck time.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
const HAS_AUTH = Boolean(env.TENZRO_BEARER_JWT && env.TENZRO_TEST_ADDRESS);
const TEST_ADDRESS = env.TENZRO_TEST_ADDRESS ?? '';
const TIMEOUT_MS = Number(env.TENZRO_TEST_TIMEOUT_MS ?? 60_000);

describe.skipIf(!HAS_AUTH)('integration: tenzro testnet smoke', () => {
  it(
    'sends 1-wei self-transfer and polls until finalized',
    async () => {
      const client = TenzroClient.testnet();
      const adapter = TenzroSdkAdapter.fromClient(client);

      // 1. Transport check — chainId is the cheapest call.
      const chainId = await adapter.getChainId();
      expect(chainId).toBe(1337);

      // 2. Auth check — getNonce requires the JWT to resolve to a real account.
      const nonce = await adapter.getNonce(TEST_ADDRESS);
      expect(nonce).toBeGreaterThanOrEqual(0);

      // 3. Submit a 1-wei self-transfer.
      const hash = await adapter.sendTransaction({
        from: TEST_ADDRESS,
        to: TEST_ADDRESS,
        value: 1n,
      });
      expect(hash).toMatch(/^[0-9a-fA-Fx]+$/);

      // 4. Poll until finalized or timeout.
      const start = Date.now();
      let last = await adapter.getTransaction(hash);
      while (last === null || last.status !== 'finalized') {
        if (Date.now() - start > TIMEOUT_MS) {
          throw new Error(
            `tx ${hash} not finalized within ${TIMEOUT_MS}ms; last=${JSON.stringify(last)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 2_000));
        last = await adapter.getTransaction(hash);
      }
      expect(last.status).toBe('finalized');
    },
    TIMEOUT_MS + 10_000,
  );
});

/**
 * Tenzro Network 1 smoke test — env-gated, read-only. Skipped in CI by default.
 *
 * Confirms the node serves what a passkey account needs to send:
 *   1. `eth_chainId` — read from the node, never assumed;
 *   2. `eth_supportedEntryPoints` — the EntryPoint UserOperations go to;
 *   3. `eth_gasPrice`;
 *   4. `tenzro_getSmartAccount` — the account's nonce (needs TENZRO_TEST_ACCOUNT).
 *
 * Required env:
 *   - TENZRO_RPC_URL — e.g. https://rpc.tenzro.xyz
 * Optional:
 *   - TENZRO_TEST_ACCOUNT — a passkey smart-account address on the network.
 *   - TENZRO_TEST_TIMEOUT_MS — default 30s.
 */

import { describe, expect, it } from 'vitest';
import { TenzroJsonRpcAdapter } from '../ports/adapters/tenzro-jsonrpc-adapter.ts';

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const RPC_URL = env.TENZRO_RPC_URL ?? '';
const TEST_ACCOUNT = env.TENZRO_TEST_ACCOUNT ?? '';
const TIMEOUT_MS = Number(env.TENZRO_TEST_TIMEOUT_MS ?? 30_000);

describe.skipIf(!RPC_URL)('integration: Tenzro Network 1 smoke', () => {
  it(
    'serves chain id, EntryPoint and gas price for passkey accounts',
    async () => {
      const port = TenzroJsonRpcAdapter.fromUrl({ url: RPC_URL });
      expect(await port.getChainId()).toBeGreaterThan(0n);
      expect(await port.getEntryPoint()).toMatch(/^0x[0-9a-f]+$/i);
      expect(await port.getGasPrice()).toBeGreaterThan(0n);
      if (TEST_ACCOUNT) {
        expect(await port.getAccountNonce(TEST_ACCOUNT)).toBeGreaterThanOrEqual(0n);
      }
    },
    TIMEOUT_MS,
  );
});

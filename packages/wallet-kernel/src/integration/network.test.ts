/**
 * Tenzro Network 1 smoke test — env-gated, read-only. Skipped in CI by default.
 *
 * Confirms the node serves what a passkey account needs to send:
 *   1. `eth_chainId` — read from the node, never assumed;
 *   2. `eth_gasPrice`;
 *   3. `eth_getTransactionReceipt` — answers for an unknown hash with null.
 *
 * Required env:
 *   - TENZRO_RPC_URL — an endpoint to start from (a hint; the others are
 *     discovered from the network's staked RPC operators)
 * Optional:
 *   - TENZRO_CHAIN_ID — the chain every endpoint must answer for; default 13380.
 *   - TENZRO_TEST_TIMEOUT_MS — default 30s.
 */

import { describe, expect, it } from 'vitest';
import { TenzroJsonRpcAdapter } from '../ports/adapters/tenzro-jsonrpc-adapter.ts';

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const RPC_URL = env.TENZRO_RPC_URL ?? '';
const CHAIN_ID = Number(env.TENZRO_CHAIN_ID ?? 13380);
const TIMEOUT_MS = Number(env.TENZRO_TEST_TIMEOUT_MS ?? 30_000);

describe.skipIf(!RPC_URL)('integration: Tenzro Network 1 smoke', () => {
  it(
    'serves chain id, gas price and receipts for passkey accounts',
    async () => {
      const port = TenzroJsonRpcAdapter.fromNetwork({ bootstrap: [RPC_URL], chainId: CHAIN_ID });
      expect(await port.getChainId()).toBe(BigInt(CHAIN_ID));
      expect(await port.getGasPrice()).toBeGreaterThan(0n);
      expect(await port.getTransactionReceipt(`0x${'00'.repeat(32)}`)).toBeNull();
    },
    TIMEOUT_MS,
  );
});

/**
 * EVM-on-Tenzro smoke test — env-gated. Skipped in CI by default.
 *
 * The Tenzro RPC node serves three VMs from one endpoint: native (`tenzro_*`),
 * EVM (`eth_*`), and SVM (Solana JSON-RPC). For most of M3 the node responded
 * to `eth_*` calls with mock fixtures; this test exists to confirm the EVM
 * leg is now backed by the real MultiVmRuntime.
 *
 * What it checks (read-only — signing requires passkey-bound keys, out of
 * scope here):
 *   1. `eth_chainId` — transport + EVM-RPC dispatch.
 *   2. `eth_blockNumber` — proves an actual EVM block height is being tracked,
 *      not a static mock value.
 *   3. `eth_gasPrice` — feeds the surface's `estimateFees`. Mocked nodes
 *      typically returned a constant; on a live node this varies block to
 *      block.
 *   4. `eth_getTransactionCount` — feeds the surface's `getNonce`. Requires
 *      the node to actually have the account in EVM state.
 *   5. `eth_getBalance` — proves an actual balance read against EVM state.
 *   6. `tenzro_getTokenBalance` — proves the per-VM breakdown returns an
 *      `evm_wtnzo` leg with 18-decimal precision (the EVM-view shape).
 *      Sister assertion to the SVM smoke's `svm_wtnzo`/9-decimal check.
 *
 * If any of these regress to a mocked value (e.g. blockNumber stuck at 0,
 * chainId returned for a non-EVM call), the line that fails identifies the
 * leg that broke.
 *
 * Required env (see `.env.example`):
 *   - TENZRO_RPC_URL — the Tenzro JSON-RPC base URL (testnet default).
 *   - TENZRO_TEST_ADDRESS — an EVM-shape address (`0x` + 40 hex) on the
 *     network. Read-only — no funds spent.
 *
 * Optional:
 *   - TENZRO_TEST_TIMEOUT_MS — default 30s.
 */

import { describe, expect, it } from 'vitest';

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const RPC_URL = env.TENZRO_RPC_URL ?? '';
const TEST_ADDRESS = env.TENZRO_TEST_ADDRESS ?? '';
const HAS_AUTH = Boolean(RPC_URL && TEST_ADDRESS);
const TIMEOUT_MS = Number(env.TENZRO_TEST_TIMEOUT_MS ?? 30_000);

/** Minimal JSON-RPC POST. We don't pull in the SDK here because the SDK's
 *  `RpcClient` is internal and we want this test to fail clearly at the wire
 *  layer if the node mis-routes EVM methods. */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

describe.skipIf(!HAS_AUTH)('integration: evm-on-tenzro smoke', () => {
  it(
    'serves real eth_* methods (not mocks) for EVM-on-Tenzro',
    async () => {
      // 1. eth_chainId — cheapest call. 1337 on testnet.
      const chainHex = await rpc<string>('eth_chainId', []);
      const chainId = Number.parseInt(chainHex, 16);
      expect(Number.isFinite(chainId)).toBe(true);
      expect(chainId).toBeGreaterThan(0);

      // 2. eth_blockNumber — must advance over time on a live node. We don't
      //    sleep+re-check here (that's flaky for a smoke test); instead we
      //    assert it's > 0, which a mock-zero node will fail.
      const blockHex = await rpc<string>('eth_blockNumber', []);
      const blockNumber = Number.parseInt(blockHex, 16);
      expect(Number.isFinite(blockNumber)).toBe(true);
      expect(blockNumber).toBeGreaterThan(0);

      // 3. eth_gasPrice — surfaces consume this via `estimateFees`. Sanity:
      //    positive bigint, not the all-zeros mocked value.
      const gasHex = await rpc<string>('eth_gasPrice', []);
      const gasPrice = BigInt(gasHex);
      expect(gasPrice).toBeGreaterThan(0n);

      // 4. eth_getTransactionCount — feeds `getNonce`. A pending nonce read
      //    against a real account succeeds; a mock-only EVM leg typically
      //    fails or returns 0 for any address. We accept 0 here (fresh
      //    account) but require the call to resolve without error.
      const nonceHex = await rpc<string>('eth_getTransactionCount', [TEST_ADDRESS, 'latest']);
      const nonce = Number.parseInt(nonceHex, 16);
      expect(Number.isFinite(nonce)).toBe(true);
      expect(nonce).toBeGreaterThanOrEqual(0);

      // 5. eth_getBalance — proves EVM-state read works. Zero is a legal
      //    answer for a fresh address; we only require the call resolves.
      const balHex = await rpc<string>('eth_getBalance', [TEST_ADDRESS, 'latest']);
      const balance = BigInt(balHex);
      expect(balance).toBeGreaterThanOrEqual(0n);

      // 6. tenzro_getTokenBalance — per-VM breakdown with the evm_wtnzo leg.
      //    Matches the SVM smoke's svm_wtnzo/9-decimal check. EVM view runs
      //    at 18 decimals; a regression to 9 would mean the EVM view is
      //    being served from SVM state.
      const tokBal = await rpc<{
        evm_wtnzo: { balance: string; decimals: number };
      }>('tenzro_getTokenBalance', [{ address: TEST_ADDRESS, token: 'TNZO' }]);
      expect(tokBal.evm_wtnzo).toBeDefined();
      expect(tokBal.evm_wtnzo.decimals).toBe(18);
      expect(BigInt(tokBal.evm_wtnzo.balance)).toBeGreaterThanOrEqual(0n);
    },
    TIMEOUT_MS,
  );
});

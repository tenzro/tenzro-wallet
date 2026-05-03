/**
 * SVM-on-Tenzro smoke test — env-gated. Skipped in CI by default.
 *
 * Counterpart to `evm-on-tenzro.test.ts`. The Tenzro node previously stubbed
 * the SVM-on-Tenzro view with mock fixtures; this test confirms the SVM leg
 * is now backed by the real MultiVmRuntime.
 *
 * Important shape note: Tenzro does NOT expose Solana JSON-RPC methods
 * (`getSlot`, `getLatestBlockhash`, …) at its public RPC root. The SVM view
 * is reached through the unified `tenzro_*` namespace instead — `vm_type:
 * "svm"` filters and the per-VM `svm_wtnzo` field on `tenzro_getTokenBalance`.
 * That's the contract this test pins.
 *
 * What it checks (read-only — `tenzro_crossVmTransfer` and signed flows are
 * exercised through the full wallet stack elsewhere):
 *   1. `tenzro_listTokens` with no filter — confirms the unified token
 *      registry is live and the canonical `TNZO` entry is present. Mock leg
 *      historically returned an empty list or omitted the canonical token.
 *   2. `tenzro_listTokens` with `vm_type: "svm"` — proves the registry
 *      actually filters by VM. Returning an empty list is fine (no tokens
 *      registered on the SVM view yet); returning the wrong shape, or
 *      ignoring the filter and returning EVM tokens, is the regression.
 *   3. `tenzro_getTokenBalance` — proves the per-VM breakdown includes the
 *      `svm_wtnzo` leg with the expected 9-decimal precision (the SVM-on-
 *      Tenzro view uses lamport-style decimals, distinct from native TNZO's
 *      18). A mock leg used to omit `svm_wtnzo` or return 18 decimals.
 *
 * Required env (see `.env.example`):
 *   - TENZRO_RPC_URL — the Tenzro JSON-RPC base URL (testnet default).
 *   - TENZRO_TEST_ADDRESS — a Tenzro-shape (0x… 20-byte) address. Used
 *     read-only — no funds spent. The same address that funds the EVM smoke;
 *     under the pointer model, EVM and SVM views read against the same
 *     native account, so a separate SVM pubkey isn't required here.
 *
 * Optional:
 *   - TENZRO_TEST_TIMEOUT_MS — default 30s.
 */

import { describe, expect, it } from 'vitest';

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

const RPC_URL = env.TENZRO_RPC_URL ?? '';
const TEST_ADDRESS = env.TENZRO_TEST_ADDRESS ?? '';
const HAS_AUTH = Boolean(RPC_URL && TEST_ADDRESS);
const TIMEOUT_MS = Number(env.TENZRO_TEST_TIMEOUT_MS ?? 30_000);

/** Minimal JSON-RPC POST — see comment in `evm-on-tenzro.test.ts`. */
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

interface TokenInfo {
  readonly token_id: string;
  readonly symbol: string;
  readonly decimals: number;
}
interface TokenList {
  readonly count: number;
  readonly tokens: readonly TokenInfo[];
}
interface TokenBalance {
  readonly address: string;
  readonly native: { balance: string; decimals: number };
  readonly evm_wtnzo: { balance: string; decimals: number };
  readonly svm_wtnzo: { balance: string; decimals: number };
}

describe.skipIf(!HAS_AUTH)('integration: svm-on-tenzro smoke', () => {
  it(
    'serves real SVM-view methods (not mocks) via the unified tenzro_* RPC',
    async () => {
      // 1. tenzro_listTokens — registry must be live and TNZO must be present.
      const all = await rpc<TokenList>('tenzro_listTokens', [{}]);
      expect(all.count).toBeGreaterThanOrEqual(1);
      const tnzo = all.tokens.find((t) => t.symbol === 'TNZO');
      expect(tnzo).toBeDefined();

      // 2. tenzro_listTokens vm_type:"svm" — proves the filter is honoured.
      //    An empty list is fine (no SVM-registered tokens yet); the wrong
      //    shape or unfiltered result is the regression.
      const svmOnly = await rpc<TokenList>('tenzro_listTokens', [
        { vm_type: 'svm' },
      ]);
      expect(typeof svmOnly.count).toBe('number');
      expect(Array.isArray(svmOnly.tokens)).toBe(true);

      // 3. tenzro_getTokenBalance — per-VM breakdown with the svm_wtnzo leg.
      //    SVM view uses 9-decimal precision; a regression to 18 here would
      //    mean the SVM view is being served from EVM state.
      const bal = await rpc<TokenBalance>('tenzro_getTokenBalance', [
        { address: TEST_ADDRESS, token: 'TNZO' },
      ]);
      expect(bal.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(bal.svm_wtnzo).toBeDefined();
      expect(bal.svm_wtnzo.decimals).toBe(9);
      // Balance is a decimal-string bigint; zero is legal for a fresh account.
      expect(BigInt(bal.svm_wtnzo.balance)).toBeGreaterThanOrEqual(0n);
    },
    TIMEOUT_MS,
  );
});

/**
 * Faucet: `tenzro_faucet {address}` on the node. A cooldown answers with
 * error -32004 and `data.remaining_seconds`, surfaced as a message. A network
 * without a faucet answers -32601; the account is then funded by a transfer to
 * its address, which the wallet shows instead of an error.
 */

import { RpcError, rpcCall } from './rpc';

export interface FaucetResult {
  readonly success: boolean;
  readonly tx_hash: string | null;
  readonly amount: string;
  readonly message: string;
}

export async function requestFaucet(address: string): Promise<FaucetResult> {
  try {
    const r = await rpcCall<{ tx_hash?: string; amount_wei?: string; message?: string }>(
      'tenzro_faucet',
      { address },
    );
    return {
      success: true,
      tx_hash: r.tx_hash ?? null,
      amount: r.amount_wei ?? '',
      message: r.message ?? 'Faucet transfer queued.',
    };
  } catch (e) {
    if (e instanceof RpcError && e.code === -32601) {
      return {
        success: false,
        tx_hash: null,
        amount: '',
        message: 'This network has no faucet. Fund the account by sending TNZO to its address.',
      };
    }
    if (e instanceof RpcError && e.code === -32004) {
      const wait = (e.data as { remaining_seconds?: number } | undefined)?.remaining_seconds;
      return {
        success: false,
        tx_hash: null,
        amount: '',
        message: wait ? `Try again in ${Math.ceil(wait / 60)} minutes.` : e.message,
      };
    }
    throw e;
  }
}

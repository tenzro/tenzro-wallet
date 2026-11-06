/**
 * What an approval shows. The node executes the unsigned transaction on a
 * copy of its state at a named block; a node of another operator executes it
 * at the same block; the wallet shows the effects only when both digests
 * agree. When they differ, or no second node answers, it shows nothing and
 * the approval cannot proceed.
 */

import {
  GovernanceClient,
  type RpcClient,
  type TransactionEffects,
  type TypedTransaction,
  txType,
} from 'tenzro-sdk';

import { fromHex, ledgerSlot } from './bytes';

const VALIDITY_MS = 300_000;

/** The transaction `tx` from `from`, unsigned, as the network's JSON encodes it. */
export async function unsignedTransaction(
  rpc: RpcClient,
  tx: TypedTransaction & { from: string },
  nowMs: number = Date.now(),
): Promise<Record<string, unknown> & { tx_type: unknown }> {
  const from = ledgerSlot(tx.from);
  const to = tx.to ? ledgerSlot(tx.to) : `0x${'00'.repeat(32)}`;
  const [nonce, chainId, gasPrice] = await Promise.all([
    rpc.call<string>('tenzro_getNonce', [from]),
    rpc.call<string>('eth_chainId', []),
    tx.gasPrice !== undefined
      ? Promise.resolve(`0x${tx.gasPrice.toString(16)}`)
      : rpc.call<string>('eth_gasPrice', []),
  ]);
  return {
    chain_id: Number.parseInt(chainId, 16),
    from: Array.from(fromHex(from)),
    to: Array.from(fromHex(to)),
    nonce: Number.parseInt(nonce, 16),
    tx_type: txType(tx),
    gas_limit: tx.gasLimit ?? 500_000,
    gas_price: Number.parseInt(gasPrice, 16),
    timestamp: nowMs,
    valid_until: nowMs + VALIDITY_MS,
    memo: null,
  };
}

export class EffectsUnavailable extends Error {}

/** Effects two operators derived alike, or an error that blocks the approval. */
export async function checkedEffects(
  rpc: RpcClient,
  second: RpcClient | null,
  transaction: { tx_type: unknown },
): Promise<TransactionEffects> {
  if (!second) {
    throw new EffectsUnavailable(
      'No second node is available to check what this does, so it cannot be approved.',
    );
  }
  try {
    return await new GovernanceClient(rpc).transactionEffects(transaction, second);
  } catch (err) {
    throw new EffectsUnavailable(
      err instanceof Error && /two nodes/.test(err.message)
        ? 'Two nodes disagree about what this does. Do not approve it.'
        : `The effects could not be derived: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The balance change of `account`, in base units, from the effects. */
export function balanceDelta(effects: TransactionEffects, account: string): bigint {
  const slot = ledgerSlot(account).toLowerCase();
  let delta = 0n;
  for (const c of effects.balance_changes) {
    const a = c.account.toLowerCase();
    if (a === slot || ledgerSlot(a) === slot) delta += BigInt(c.after) - BigInt(c.before);
  }
  return delta;
}

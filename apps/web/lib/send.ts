/**
 * Sending TNZO from the account. The person sees what the network says the
 * transfer does (derived by two operators' nodes) before the passkey signs.
 */

import {
  type HybridSigner,
  type RpcClient,
  type TypedTransaction,
  TypedTxClient,
} from 'tenzro-sdk';

import { isAccount, ledgerSlot, weiJson } from './bytes';

/** A native transfer of `amount` base units to `to`. */
export function transfer(to: string, amount: bigint): TypedTransaction {
  if (!isAccount(to)) throw new Error('Enter a 20- or 32-byte account.');
  if (amount <= 0n) throw new Error('Enter an amount above zero.');
  return { kind: 'Transfer', to: ledgerSlot(to), fields: { amount: weiJson(amount) } };
}

/** Signs `tx` from the account with this device's passkey and submits it. */
export async function sendFromAccount(
  rpc: RpcClient,
  signer: HybridSigner,
  account: string,
  tx: TypedTransaction,
): Promise<string> {
  const result = await new TypedTxClient(rpc).send(signer, { ...tx, from: account });
  if (typeof result === 'string') return result;
  const r = result as { tx_hash?: string; hash?: string } | null;
  return r?.tx_hash ?? r?.hash ?? '';
}

export async function balanceOf(rpc: RpcClient, account: string): Promise<bigint> {
  const hex = await rpc.call<string>('eth_getBalance', [account, 'latest']);
  return BigInt(hex);
}

/**
 * Typed read wrappers around the Tenzro Network 1 RPC methods the web
 * wallet uses. Everything here is a read; no session token is involved.
 */

import { rpcCall } from './rpc';

/** Latest block height, 0x-prefixed hex. */
export function getBlockNumber(): Promise<string> {
  return rpcCall<string>('eth_blockNumber', []);
}

/** Chain id as the node reports it. */
export function getChainId(): Promise<string> {
  return rpcCall<string>('eth_chainId', []);
}

/** Native TNZO balance in wei, 0x-prefixed hex. */
export function getBalance(address: string): Promise<string> {
  return rpcCall<string>('eth_getBalance', [address, 'latest']);
}

/**
 * Views of the same TNZO balance on each VM (native ledger, EVM, SVM, DAML).
 * They are views over one balance, not separate wallets. SVM uses 9 decimals.
 */
export interface TokenProjection {
  readonly balance: string;
  readonly decimals: number;
  readonly display?: string;
}

export interface TokenBalances {
  readonly address: string;
  readonly native: TokenProjection;
  readonly evm_wtnzo: TokenProjection;
  readonly svm_wtnzo: TokenProjection;
  readonly daml_holding: { readonly amount: string };
}

export function getTokenBalance(address: string): Promise<TokenBalances> {
  return rpcCall<TokenBalances>('tenzro_getTokenBalance', { address });
}

export interface TenzroTransaction {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly amount?: string;
  readonly value?: string;
  readonly asset?: string;
  readonly status?: string;
  readonly block_height?: number;
  readonly timestamp?: number;
  readonly tx_type?: string;
}

/** Recent transactions known to the answering node. */
export function getTransactionHistory(address: string): Promise<TenzroTransaction[]> {
  return rpcCall<TenzroTransaction[]>('tenzro_getTransactionHistory', [address]);
}

export function getUserOperationReceipt(
  hash: string,
): Promise<{ success: boolean; userOpHash: string } | null> {
  return rpcCall('eth_getUserOperationReceipt', [hash]);
}

/** An AP2 mandate: an agent allowed to pay on this account's behalf, within limits. */
/** An agent this identity controls, with the daily limit its terms set. */
export interface DelegatedAgent {
  readonly agent_did: string;
  /** Base units; null when the terms set no daily limit. */
  readonly max_daily_spend: string | null;
  /** Base units spent today. */
  readonly current_daily_spend: string;
}

/**
 * Agents this identity controls: the controlled DIDs on its identity record,
 * each with the spend its on-chain terms allow today. A controlled machine
 * that is not an agent has no terms (the node answers null) and is left out.
 */
export async function listDelegatedAgents(controllerDid: string): Promise<DelegatedAgent[]> {
  const res = await rpcCall<{
    record?: { identity_data?: { Human?: { controlled_machines?: string[] } } };
  }>('tenzro_resolveIdentity', { did: controllerDid, include_record: true });
  const dids = res.record?.identity_data?.Human?.controlled_machines ?? [];
  const spends = await Promise.allSettled(
    dids.map((did) =>
      rpcCall<{ max_daily_spend?: string | null; current_daily_spend?: string } | null>(
        'tenzro_getAgentDailySpend',
        { agent_did: did },
      ),
    ),
  );
  const out: DelegatedAgent[] = [];
  spends.forEach((r, i) => {
    if (r.status !== 'fulfilled' || r.value === null) return;
    out.push({
      agent_did: dids[i] as string,
      max_daily_spend: r.value.max_daily_spend ?? null,
      current_daily_spend: r.value.current_daily_spend ?? '0',
    });
  });
  return out;
}

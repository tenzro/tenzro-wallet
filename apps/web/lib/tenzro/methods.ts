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

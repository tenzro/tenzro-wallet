/**
 * Typed read wrappers around the Tenzro Network 1 RPC methods the web
 * wallet uses. Everything here is a read; no session token is involved.
 */

import type { SplitRule } from 'tenzro-sdk';

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

/** The TNZO/USD rate fees are priced at, from consensus (`tenzro_getFeeRate`). */
export interface FeeRate {
  /** USD per TNZO, in nano-USD, decimal string. */
  readonly rate_nano_usd: string;
  readonly mode?: string;
}

export function getFeeRate(): Promise<FeeRate> {
  return rpcCall<FeeRate>('tenzro_getFeeRate', {});
}

/** The standing split every payment to `payee` is divided by, `null` when none. */
export function getPayeeSplit(payee: string): Promise<{ rule: SplitRule | null }> {
  return rpcCall('tenzro_getPayeeSplit', { payee });
}

/** One consensus payment record from the event index. */
export interface PaymentEntry {
  readonly cursor: string;
  readonly tx_hash: string;
  readonly record: Record<string, unknown>;
}

/** Payments received by `payee`, newest last (`tenzro_listPayments`). */
export function listPayouts(
  payee: string,
  limit = 25,
): Promise<{ payments: PaymentEntry[]; cursor: string | null }> {
  return rpcCall('tenzro_listPayments', { payee, limit });
}

/** The split engine's division of `gross` under `split`, as the chain makes it (`tenzro_previewSplit`). */
export interface SplitPreview {
  readonly allocation: {
    readonly gross: string;
    readonly fee: { fee: string; burn: string; treasury: string; insurance: string };
    readonly network_fees: string;
    readonly net: string;
    readonly credits: string[];
  };
  readonly split_hash: string;
}

export function previewSplit(
  gross: bigint,
  split: SplitRule,
  networkFees = 0n,
): Promise<SplitPreview> {
  return rpcCall('tenzro_previewSplit', {
    gross: gross.toString(),
    split,
    network_fees: networkFees.toString(),
  });
}

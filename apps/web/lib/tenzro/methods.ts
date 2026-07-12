/**
 * Typed wrappers around the Tenzro testnet RPC methods we actually use.
 *
 * Method shapes were probed against the live RPC at rpc.tenzro.xyz
 * — names, param positions and result shapes are pinned to whatever
 * the network responds with today. If a method later gains options,
 * extend the wrapper rather than dropping into raw `rpcCall`.
 */

import { TENZRO_DPOP_HTU } from './config';
import { mintDpopProof } from './dpop';
import { rpcCall, rpcCallAuthed } from './rpc';

/** Returns the latest block height as a 0x-prefixed hex string. */
export function getBlockNumber(): Promise<string> {
  return rpcCall<string>('tenzro_blockNumber', []);
}

/**
 * Native TNZO balance for an address. Returns a 0x-prefixed hex string
 * in base units. The asset hint is currently ignored by the testnet
 * but accepted for forward compatibility.
 */
export function getBalance(address: string, asset = 'TNZO'): Promise<string> {
  return rpcCall<string>('tenzro_getBalance', { address, asset });
}

/** Outbound nonce — needed for ordered submission. Hex string. */
export function getNonce(address: string): Promise<string> {
  return rpcCall<string>('tenzro_getNonce', [address]);
}

/**
 * Per-VM projections of the same Tenzro wallet's TNZO balance.
 *
 * Tenzro is chain-agnostic: one address holds native TNZO, and the
 * pointer-token model surfaces the same balance through wrapped
 * representations on each VM (wTNZO ERC-20 for EVM, an SPL adapter
 * for SVM, a CIP-56 DAML holding for Canton). They are *views* over
 * one balance, not separate wallets.
 *
 * Note SVM's 9 decimals (Solana convention) vs EVM's 18.
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

export interface RegisteredToken {
  readonly token_id: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly total_supply: string;
  readonly evm_address?: string;
}

export function listTokens(): Promise<{ count: number; tokens: RegisteredToken[] }> {
  return rpcCall<{ count: number; tokens: RegisteredToken[] }>('tenzro_listTokens', []);
}

export interface TenzroTransaction {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly asset?: string;
  readonly status?: string;
  readonly block_height?: number;
  readonly timestamp?: number;
  readonly tx_type?: string;
  readonly gas_used?: number;
  readonly fee?: string;
}

export function getTransactionHistory(address: string): Promise<TenzroTransaction[]> {
  return rpcCall<TenzroTransaction[]>('tenzro_getTransactionHistory', [address]);
}

export function getTransaction(hash: string): Promise<TenzroTransaction | null> {
  return rpcCall<TenzroTransaction | null>('tenzro_getTransaction', [hash]);
}

/**
 * The set of VMs the testnet's pointer-token model exposes. The native
 * Tenzro ledger is one VM among four — `tenzro_crossVmTransfer` and
 * `tenzro_wrapTnzo` accept any of these strings for `from_vm` / `to_vm`.
 */
export type TenzroVm = 'native' | 'evm' | 'svm' | 'canton';

/**
 * Move TNZO between VM projections of the *same* wallet (or, with
 * different from/to addresses, between two Tenzro wallets). This is
 * internal pointer-token bookkeeping — no bridge, no liquidity risk,
 * the underlying balance never leaves Tenzro.
 */
export interface CrossVmTransferArgs {
  readonly from_address: string;
  readonly to_address: string;
  readonly amount: string;
  readonly from_vm: TenzroVm;
  readonly to_vm: TenzroVm;
}

export async function crossVmTransfer(
  args: CrossVmTransferArgs,
  jwt: string,
): Promise<{ tx_hash: string }> {
  const dpopProof = await mintDpopProof(TENZRO_DPOP_HTU, 'POST', jwt);
  const result = await rpcCallAuthed<string | { tx_hash: string }>('tenzro_crossVmTransfer', args, {
    jwt,
    dpopProof,
  });
  return typeof result === 'string' ? { tx_hash: result } : result;
}

/**
 * Wrap native TNZO into a VM-specific representation (e.g. native →
 * wTNZO ERC-20 view). Same wallet, same address, just shifts the
 * accounting layer.
 */
export interface WrapTnzoArgs {
  readonly address: string;
  readonly amount: string;
  readonly to_vm: Exclude<TenzroVm, 'native'>;
}

export async function wrapTnzo(args: WrapTnzoArgs, jwt: string): Promise<{ tx_hash: string }> {
  const dpopProof = await mintDpopProof(TENZRO_DPOP_HTU, 'POST', jwt);
  const result = await rpcCallAuthed<string | { tx_hash: string }>('tenzro_wrapTnzo', args, {
    jwt,
    dpopProof,
  });
  return typeof result === 'string' ? { tx_hash: result } : result;
}

/**
 * Send TNZO to a real external chain (Ethereum, Base, Solana, …) via
 * LayerZero V2. The recipient is the user's external wallet — Tenzro
 * does not custody that key.
 *
 * Status: the testnet RPC is wired but `tenzro_listChains` returns
 * an empty set today, so any non-Tenzro `dest_chain` will fail with
 * `"No route available from tenzro to <chain>"`. Surface that to the
 * UI as "no bridge route configured" rather than a generic error.
 */
export interface BridgeTokensArgs {
  readonly source_chain: 'tenzro';
  readonly dest_chain: string;
  readonly sender: string;
  readonly recipient: string;
  readonly amount: string;
  readonly asset: string;
}

export interface BridgeTokensResult {
  readonly status: 'success' | 'failed' | string;
  readonly tx_hash?: string;
  readonly error?: string;
  readonly source_chain?: string;
  readonly dest_chain?: string;
}

export async function bridgeTokens(
  args: BridgeTokensArgs,
  jwt: string,
): Promise<BridgeTokensResult> {
  const dpopProof = await mintDpopProof(TENZRO_DPOP_HTU, 'POST', jwt);
  return rpcCallAuthed<BridgeTokensResult>('tenzro_bridgeTokens', args, { jwt, dpopProof });
}

export interface SignAndSendArgs {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly asset?: string;
}

export interface SignAndSendResult {
  readonly tx_hash: string;
}

/**
 * Submit a transfer. The Tenzro testnet's "human" custody model has
 * the server sign on behalf of the DID after authenticating the
 * caller — we just supply the intent and the JWT proves authority.
 *
 * Auth: DPoP scheme — server demands `Authorization: DPoP <jwt>` plus
 * a fresh JWS-compact proof in the `DPoP` header (RFC 9449). The proof's
 * `htu` must match the server's *internal* bind URL (see TENZRO_DPOP_HTU);
 * proofs that name the public hostname are rejected with htu mismatch.
 *
 * Server validation: rejects self-sends (`to == from`) with
 * "cannot transfer to self" — surface that to the UI as-is.
 *
 * Result shape: the RPC returns the tx hash as a bare hex string, not
 * an object — we wrap it so callers see a stable `{ tx_hash }`.
 */
export async function signAndSendTransaction(
  args: SignAndSendArgs,
  jwt: string,
): Promise<SignAndSendResult> {
  const dpopProof = await mintDpopProof(TENZRO_DPOP_HTU, 'POST', jwt);
  const txHash = await rpcCallAuthed<string>(
    'tenzro_signAndSendTransaction',
    { from: args.from, to: args.to, amount: args.amount, asset: args.asset ?? 'TNZO' },
    { jwt, dpopProof },
  );
  return { tx_hash: txHash };
}

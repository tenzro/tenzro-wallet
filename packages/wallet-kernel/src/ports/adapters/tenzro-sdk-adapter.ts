/**
 * TenzroSdkAdapter — the only kernel file that imports from `tenzro-sdk`.
 *
 * Wraps a `TenzroClient` (or any object with the same shape — useful when
 * tests want to swap a partial fake) and exposes the narrow `TenzroRpcPort`
 * surface the kernel actually uses. If the SDK's shape changes, this is the
 * single file that breaks; the rest of the kernel stays put.
 *
 * Two construction paths:
 *
 *  1. **Direct fetch transport** — `fromClient(new TenzroClient(config))`
 *     is the M2 path: the kernel/host owns the bearer JWT + DPoP proof and
 *     the SDK's default `RpcClient` reads them from ambient env (`rpc.ts`).
 *
 *  2. **Injected EIP-1193 transport** — `fromInjected({rdns, timeoutMs})`
 *     is the M6 path: a dApp page loads, discovers `window.tenzro` via
 *     EIP-6963, and routes every `client.rpc.call(...)` through
 *     `provider.request(...)` so the extension owns auth + user
 *     confirmation. The SDK's `TenzroClient.fromInjected()` does the
 *     discovery + transport wiring for us.
 */

import {
  type TenzroClient as SdkTenzroClient,
  TenzroClient,
  TenzroNotInstalledError,
  type TenzroConfig,
} from 'tenzro-sdk';
import type {
  TenzroRpcPort,
  TenzroSendArgs,
  TenzroTxStatus,
} from '../tenzro-rpc.ts';

/**
 * Just the slice of `TenzroClient` the adapter touches. Listed explicitly so
 * tests can inject a hand-rolled object instead of the full SDK class.
 */
export interface TenzroClientLike {
  getNonce(address: string): Promise<number>;
  getChainId(): Promise<number>;
  getFinalizedBlock(): Promise<number>;
  getTransaction(hash: string): Promise<{
    hash: string;
    blockHeight?: number;
  } | null>;
  sendTransaction(params: {
    from: string;
    to: string;
    value: bigint;
    gas_limit?: number;
    gas_price?: number;
    nonce?: number;
    chain_id?: number;
  }): Promise<string>;
}

export class TenzroSdkAdapter implements TenzroRpcPort {
  constructor(private readonly client: TenzroClientLike) {}

  /** Construct from a real `TenzroClient`. The cast is safe because
   *  `TenzroClient` already implements `TenzroClientLike`. */
  static fromClient(client: SdkTenzroClient): TenzroSdkAdapter {
    return new TenzroSdkAdapter(client as unknown as TenzroClientLike);
  }

  /**
   * Construct an adapter that routes RPCs through an injected EIP-1193
   * provider (`window.tenzro`) discovered via EIP-6963.
   *
   * Resolves only after the extension announces a provider matching
   * `rdns` (defaults to `TENZRO_PROVIDER_RDNS`). Rejects with the SDK's
   * `TenzroNotInstalledError` if no announcement arrives within
   * `timeoutMs` (default 3000) — dApps should catch that and render an
   * "Install Tenzro" CTA.
   *
   * The SDK's `fromInjected` wires `Eip1193Transport` internally, so
   * neither this adapter nor the rest of the kernel needs to know that
   * the underlying transport is a `provider.request(...)` call rather
   * than a `fetch` to `rpc.tenzro.network`.
   *
   * Re-exports `TenzroNotInstalledError` so callers don't need a second
   * dependency on `tenzro-sdk` purely to type the catch arm.
   */
  static async fromInjected(options?: {
    config?: TenzroConfig;
    timeoutMs?: number;
    rdns?: string;
  }): Promise<TenzroSdkAdapter> {
    const client = await TenzroClient.fromInjected(options);
    return TenzroSdkAdapter.fromClient(client);
  }

  getNonce(address: string): Promise<number> {
    return this.client.getNonce(address);
  }

  getChainId(): Promise<number> {
    return this.client.getChainId();
  }

  async sendTransaction(args: TenzroSendArgs): Promise<string> {
    // Map our camelCase port shape to the SDK's snake_case wire shape.
    const params: Parameters<TenzroClientLike['sendTransaction']>[0] = {
      from: args.from,
      to: args.to,
      value: args.value,
    };
    if (args.gasLimit !== undefined) params.gas_limit = args.gasLimit;
    if (args.gasPrice !== undefined) params.gas_price = args.gasPrice;
    if (args.nonce !== undefined) params.nonce = args.nonce;
    if (args.chainId !== undefined) params.chain_id = args.chainId;
    return this.client.sendTransaction(params);
  }

  async getTransaction(hash: string): Promise<TenzroTxStatus | null> {
    const tx = await this.client.getTransaction(hash);
    if (tx === null) return null;
    // The SDK's `Transaction` has no explicit status field; we infer:
    //  - `blockHeight` unset → still in mempool → 'pending'
    //  - `blockHeight` set, ≤ finalized → 'finalized'
    //  - `blockHeight` set, > finalized → 'included'
    if (tx.blockHeight === undefined) {
      return { hash: tx.hash, status: 'pending' };
    }
    const finalized = await this.client.getFinalizedBlock();
    const status: TenzroTxStatus['status'] =
      tx.blockHeight <= finalized ? 'finalized' : 'included';
    return { hash: tx.hash, status, blockHeight: tx.blockHeight };
  }
}

/**
 * Re-export so kernel consumers can `instanceof`-check the not-installed
 * case without taking a direct dependency on `tenzro-sdk`. The kernel's
 * adapter layer is the only place SDK types should leak in from.
 */
export { TenzroNotInstalledError };

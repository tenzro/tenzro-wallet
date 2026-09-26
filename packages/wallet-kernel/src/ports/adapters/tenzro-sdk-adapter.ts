/**
 * TenzroSdkAdapter — read helpers over the `tenzro-sdk` client.
 *
 * Wraps a `TenzroClient` (or any object with the same shape — useful when
 * tests want to swap a partial fake) and exposes nonce, chain id and
 * transaction status reads. Sending from a passkey account goes through
 * `TenzroJsonRpcAdapter` (UserOperations signed on the device); this adapter
 * never submits anything.
 *
 * Two construction paths:
 *
 *  1. **Direct fetch transport** — `fromClient(new TenzroClient(config))`.
 *
 *  2. **Injected EIP-1193 transport** — `fromInjected({rdns, timeoutMs})`:
 *     a dApp page discovers `window.tenzro` via EIP-6963 and routes every
 *     `client.rpc.call(...)` through `provider.request(...)`, so the wallet
 *     owns user confirmation.
 */

import {
  type TenzroClient as SdkTenzroClient,
  TenzroClient,
  type TenzroConfig,
  TenzroNotInstalledError,
} from 'tenzro-sdk';
import type { TenzroTxStatus } from '../tenzro-rpc.ts';

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
}

export class TenzroSdkAdapter {
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
   * than a `fetch` to `rpc.tenzro.xyz`.
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
    const status: TenzroTxStatus['status'] = tx.blockHeight <= finalized ? 'finalized' : 'included';
    return { hash: tx.hash, status, blockHeight: tx.blockHeight };
  }
}

/**
 * Re-export so kernel consumers can `instanceof`-check the not-installed
 * case without taking a direct dependency on `tenzro-sdk`. The kernel's
 * adapter layer is the only place SDK types should leak in from.
 */
export { TenzroNotInstalledError };

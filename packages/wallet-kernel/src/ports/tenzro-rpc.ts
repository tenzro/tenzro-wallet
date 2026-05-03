/**
 * TenzroRpcPort — the kernel's view of the Tenzro Ledger JSON-RPC.
 *
 * The port is the only contract the surface modules (and tests) care about.
 * The real implementation in `adapters/tenzro-sdk-adapter.ts` wraps
 * `tenzro-sdk`'s `TenzroClient`. Tests inject in-memory fakes shaped like
 * this interface, so nothing under `src/surfaces/` or `src/kernel.ts` ever
 * imports from `tenzro-sdk` directly.
 *
 * Why a port at all (instead of taking the SDK type as the parameter):
 *  - `tenzro-sdk` is a moving target on testnet. Pinning the surface modules
 *    to its exact shape would mean every SDK release touches every surface.
 *  - We only need a tiny slice of the SDK; the port documents that slice.
 *  - Tests can build a fake without instantiating an `RpcClient`.
 *
 * Spec refs:
 *  - https://tenzro.com/docs/wallet-sdk
 *  - https://tenzro.com/docs/typescript-sdk
 */

/**
 * Server-side hybrid-signed transaction submission.
 * Maps to `tenzro_signAndSendTransaction` (see SDK `WalletClient.signAndSend`).
 *
 * The node holds the TEE share of a 2-of-2 passkey-quorum (per DESIGN.md §4.3),
 * derives the canonical preimage including the PQ pubkey, signs both Ed25519
 * and ML-DSA-65 legs, and submits. Authorisation is via the ambient DPoP-bound
 * session JWT (the SDK's `RpcClient` reads `TENZRO_BEARER_JWT` /
 * `TENZRO_DPOP_PROOF` env vars and sets the headers automatically).
 */
export interface TenzroSendArgs {
  /** Sender's Tenzro-shape address (20-byte hex, "0x..."). */
  readonly from: string;
  /** Recipient's Tenzro-shape address. */
  readonly to: string;
  /** Amount in canonical units (1 TNZO = 10^18). */
  readonly value: bigint;
  /** Defaults to 21000 in the SDK. */
  readonly gasLimit?: number;
  /** Defaults to 1 gwei in the SDK. */
  readonly gasPrice?: number;
  /** Optional nonce override; SDK fetches if omitted. */
  readonly nonce?: number;
  /** Optional chain id override; SDK fetches if omitted. */
  readonly chainId?: number;
}

/**
 * On-chain transaction state — kept narrow on purpose. Surfaces the only
 * fields the kernel's `watch()` walk needs to translate to a TxStatus.phase.
 */
export interface TenzroTxStatus {
  /** 64-char lowercase hex, no '0x' prefix per SDK convention. */
  readonly hash: string;
  /** 'pending' before inclusion, 'included' after, 'finalized' after the
   *  finalized-block-height crosses the inclusion height. */
  readonly status: 'pending' | 'included' | 'finalized' | 'failed';
  /** Block height at which the tx was included; absent when pending. */
  readonly blockHeight?: number;
}

/**
 * The kernel-facing slice of Tenzro RPC. Implemented for real by
 * `TenzroSdkAdapter`; faked in-memory for tests.
 */
export interface TenzroRpcPort {
  /** Latest nonce for an address (for transaction ordering). */
  getNonce(address: string): Promise<number>;

  /** Chain id. Maps to `eth_chainId` in the SDK. */
  getChainId(): Promise<number>;

  /**
   * Server-side sign + submit. Returns the tx hash.
   * Throws if the session is unauthenticated or the TEE refuses to co-sign.
   */
  sendTransaction(args: TenzroSendArgs): Promise<string>;

  /**
   * Look up a tx by hash. Returns `null` if the node has never seen it.
   * Used by the kernel's `watch()` poll loop.
   */
  getTransaction(hash: string): Promise<TenzroTxStatus | null>;
}

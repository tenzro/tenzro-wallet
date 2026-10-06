/**
 * TenzroRpcPort — the kernel's view of the Tenzro Ledger JSON-RPC for a
 * passkey account.
 *
 * A person's account acts through native transactions its keystore in
 * consensus state authorizes. The node never signs for it: the wallet builds
 * the transaction, a passkey the keystore links signs its digest on the
 * device, and the network admits it like any other transaction.
 *
 * Real builds inject `TenzroJsonRpcAdapter`; tests inject in-memory fakes.
 * Nothing under `src/surfaces/` or `src/kernel.ts` talks to the network
 * directly.
 *
 * Node methods: eth_chainId, eth_gasPrice, tenzro_getNonce,
 * tenzro_getSigningPayload, tenzro_sendRawTransaction,
 * eth_getTransactionReceipt.
 */

import type { HybridSigner, SignedTransactionJson, TypedTransaction } from 'tenzro-sdk';

/** Outcome of an executed transaction (`eth_getTransactionReceipt`). */
export interface TransactionReceipt {
  readonly hash: string;
  readonly success: boolean;
}

/**
 * On-chain transaction state for plain transactions, used by read helpers
 * such as `TenzroSdkAdapter.getTransaction`.
 */
export interface TenzroTxStatus {
  readonly hash: string;
  readonly status: 'pending' | 'included' | 'finalized' | 'failed';
  readonly blockHeight?: number;
}

export interface TenzroRpcPort {
  /** `eth_chainId`. Read from the node; never assumed. */
  getChainId(): Promise<bigint>;

  /** Current gas price in wei (`eth_gasPrice`). */
  getGasPrice(): Promise<bigint>;

  /**
   * Sign `tx` with `signer` without submitting it: the nonce, chain id and
   * signing payload come from the node, and the payload is checked to be
   * the transaction built before the passkey signs.
   */
  signTransaction(signer: HybridSigner, tx: TypedTransaction): Promise<SignedTransactionJson>;

  /** `tenzro_sendRawTransaction`. Returns the transaction hash. */
  sendTransaction(signed: SignedTransactionJson): Promise<string>;

  /** `null` while the node has not executed the transaction. */
  getTransactionReceipt(hash: string): Promise<TransactionReceipt | null>;
}
